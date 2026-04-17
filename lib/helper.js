const axios = require("axios")
const https = require("https")
const crypto = require("crypto")
const stream = require("stream/promises")
const cds = require("@sap/cds")
const LOG = cds.log("attachments")
const { extname } = require("path")

/**
 * Validates the presence of required Service Manager credentials
 * @param {*} serviceManagerCreds - Service Manager credentials object
 * @throws Will throw an error if validation fails
 */
function validateServiceManagerCredentials(serviceManagerCreds) {
  if (!serviceManagerCreds) {
    LOG.error(
      "serviceManager.credentials is missing",
      "Bind a Service Manager instance for separate object store mode",
    )
    throw new Error("Service Manager Instance is not bound")
  }

  const requiredSmFields = ["sm_url", "url", "clientid"]
  const missingSmFields = requiredSmFields.filter(
    (field) => !serviceManagerCreds[field],
  )

  if (missingSmFields.length > 0) {
    LOG.error(
      "serviceManager.credentials is missing a few fields. Passed object: ",
      serviceManagerCreds,
      `Service Manager credentials missing: ${missingSmFields.join(", ")}`,
    )
    throw new Error(
      `Missing Service Manager credentials: ${missingSmFields.join(", ")}`,
    )
  }
}

/**
 * Validates the inputs required for fetching object store credentials
 * @param {string} tenantID - Tenant ID
 * @param {string} sm_url - Service Manager URL
 * @param {string} token - Access token
 * @returns
 */
function validateInputs(tenantID, sm_url, token) {
  if (!tenantID) {
    LOG.error(
      "Tenant ID is required for object store credentials",
      null,
      "Ensure multitenancy is properly configured and tenant context is available",
      { tenantID },
    )
    return false
  }

  if (!sm_url) {
    LOG.error(
      "serviceManager.credentials.sm_url",
      sm_url,
      false,
      "Bind a Service Manager instance to your application",
    )
    return false
  }

  if (!token) {
    LOG.error(
      "Access token is required for Service Manager API",
      null,
      "Check if token fetching completed successfully",
      { hasToken: !!token },
    )
    return false
  }

  return true
}

function getAttachmentKind() {
  const kind = cds.env.requires?.attachments?.kind
  if (kind == "standard") {
    return cds.env.requires?.objectStore?.credentials?.access_key_id
      ? "aws-s3"
      : cds.env.requires?.objectStore?.credentials?.container_name
        ? "azure-blob-storage"
        : cds.env.requires?.objectStore?.credentials?.projectId
          ? "gcp"
          : "aws-s3"
  }
  return "db"
}

/**
 * Fetches object store service binding from Service Manager
 * @param {string} tenantID - Tenant ID
 * @param {string?} token - Access token, if nothing is provided access token is fetched
 * @returns {Promise<Array>} - Promise resolving to array of service bindings
 */
async function fetchObjectStoreBinding(tenantID, token) {
  const serviceManagerCreds = cds.env.requires?.serviceManager?.credentials

  validateServiceManagerCredentials(serviceManagerCreds)

  const { sm_url, url, clientid, clientsecret, certificate, key, certurl } =
    serviceManagerCreds

  if (!token) {
    LOG.debug("Fetching access token for tenant", { tenantID, sm_url: sm_url })
    token = await fetchToken(
      url,
      clientid,
      clientsecret,
      certificate,
      key,
      certurl,
    )
  }

  LOG.debug("Fetching object store credentials", { tenantID, sm_url })

  if (!validateInputs(tenantID, sm_url, token)) {
    return null
  }

  LOG.debug("Making Service Manager API call", {
    tenantID,
    endpoint: `${sm_url}/v1/service_bindings`,
    labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenantID}'`,
  })
  const response = await axios.get(`${sm_url}/v1/service_bindings`, {
    params: {
      labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenantID}'`,
    },
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })

  return response.data?.items || []
}

/**
 * Retrieves object store credentials for a given tenant
 * @param {string} tenantID - Tenant ID
 * @returns {Promise<Object|null>} - Promise resolving to object store credentials or null
 */
async function getObjectStoreCredentials(tenantID) {
  try {
    const items = await fetchObjectStoreBinding(tenantID)

    if (!items.length) {
      LOG.error(
        `No object store service binding found for tenant`,
        null,
        "Ensure an Object Store instance is subscribed and bound for this tenant",
        { tenantID, itemsFound: 0 },
      )
      return null
    }

    const credentials = items[0]
    LOG.info("Object store credentials retrieved successfully", {
      tenantID,
      hasCredentials: !!credentials,
      bucket: credentials?.credentials?.bucket,
    })

    return credentials
  } catch (error) {
    const suggestion =
      error.response?.status === 401
        ? "Check Service Manager credentials and token validity"
        : error.response?.status === 404
          ? "Verify Service Manager URL and API endpoint"
          : "Check network connectivity and Service Manager instance health"

    LOG.error("Failed to fetch object store credentials", error, suggestion, {
      tenantID,
      httpStatus: error.response?.status,
      responseData: error.response?.data,
    })
    return null
  }
}

/**
 * Fetches an OAuth token using either client credentials or MTLS
 * @param {string} url - Token endpoint URL
 * @param {string} clientid - Client ID
 * @param {string} clientsecret - Client Secret
 * @param {string} certificate - MTLS Certificate
 * @param {string} key - MTLS Key
 * @param {string} certURL - MTLS Certificate URL
 * @returns {Promise<string>} - Promise resolving to access token
 */
async function fetchToken(
  url,
  clientid,
  clientsecret,
  certificate,
  key,
  certURL,
) {
  LOG.info("Determining token fetch method", {
    hasClientCredentials: !!(clientid && clientsecret),
    hasMTLSCredentials: !!(certificate && key && certURL),
    url,
    clientid,
  })

  // Validate credentials
  if (!clientid) {
    LOG.error(
      "serviceManager.credentials.clientid is missing",
      "Check Service Manager service binding for client ID",
    )
    throw new Error("Client ID is required for token fetching")
  }

  if (certificate && key && certURL) {
    LOG.debug("Using MTLS authentication for token fetch", {
      clientid,
      certURL,
    })
    return fetchTokenWithMTLS(certURL, clientid, certificate, key)
  } else if (clientid && clientsecret) {
    LOG.debug("Using client credentials authentication for token fetch", {
      clientid,
      url,
    })
    return fetchTokenWithClientSecret(url, clientid, clientsecret)
  } else {
    const suggestion =
      "Ensure Service Manager binding includes either (clientid + clientsecret) or (certificate + key + certurl)"
    LOG.error("Insufficient credentials for token fetching", null, suggestion, {
      hasClientId: !!clientid,
      hasClientSecret: !!clientsecret,
      hasCertificate: !!certificate,
      hasKey: !!key,
      hasCertURL: !!certURL,
    })
    throw new Error("Invalid credentials provided for token fetching.")
  }
}

/**
 * Fetches OAuth token using client credentials flow
 * @param {string} url - Token endpoint URL
 * @param {string} clientid - Client ID
 * @param {string} clientsecret - Client Secret
 * @returns
 */
async function fetchTokenWithClientSecret(url, clientid, clientsecret) {
  const startTime = Date.now()

  try {
    LOG.debug("Initiating OAuth client credentials flow", {
      endpoint: `${url}/oauth/token`,
      clientid,
    })

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    }

    const response = await axios.post(`${url}/oauth/token`, null, {
      headers,
      params: {
        grant_type: "client_credentials",
        client_id: clientid,
        client_secret: clientsecret,
      },
    })

    const duration = Date.now() - startTime
    LOG.debug("OAuth token fetched successfully", {
      clientid,
      duration,
      tokenType: response.data?.token_type,
    })

    return response.data.access_token
  } catch (error) {
    const duration = Date.now() - startTime
    const suggestion =
      error.response?.status === 401
        ? "Verify Service Manager client credentials (clientid and clientsecret)"
        : error.response?.status === 404
          ? "Check Service Manager URL is correct"
          : "Verify Service Manager instance is running and accessible"

    LOG.error(
      "Failed to fetch OAuth token using client credentials",
      error,
      suggestion,
      {
        clientid,
        duration,
        httpStatus: error.response?.status,
        errorMessage: error.message,
      },
    )

    throw error
  }
}

/**
 * Fetches OAuth token using MTLS authentication
 * @param {string} certURL - Certificate URL
 * @param {string} clientid - Client ID
 * @param {string} certificate - MTLS Certificate
 * @param {string} key - MTLS Key
 * @returns {Promise<string>} - Promise resolving to access token
 */
async function fetchTokenWithMTLS(certURL, clientid, certificate, key) {
  const startTime = Date.now()

  try {
    LOG.debug("Initiating MTLS authentication flow", {
      endpoint: `${certURL}/oauth/token`,
      clientid,
    })

    const requestBody = new URLSearchParams({
      grant_type: "client_credentials",
      response_type: "token",
      client_id: clientid,
    }).toString()

    const options = {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      url: `${certURL}/oauth/token`,
      method: "POST",
      data: requestBody,
      httpsAgent: new https.Agent({
        cert: certificate,
        key: key,
      }),
    }

    const response = await axios(options)
    const duration = Date.now() - startTime

    if (!response.data?.access_token) {
      LOG.error(
        "MTLS token response missing access_token",
        null,
        "Check MTLS certificate/key validity and Service Manager configuration",
        { clientid, duration, responseData: response.data },
      )
      throw new Error("Access token not found in MTLS token response")
    }

    LOG.debug("MTLS token fetched successfully", {
      clientid,
      duration,
      tokenType: response.data.token_type,
    })

    return response.data.access_token
  } catch (error) {
    const duration = Date.now() - startTime

    LOG.error(
      "Failed to fetch OAuth token using MTLS",
      error,
      "Check MTLS certificate, key, and Service Manager connectivity",
      {
        clientid,
        duration,
        httpStatus: error.response?.status,
        errorMessage: error.message,
      },
    )

    throw error
  }
}

/**
 * Checks if the given mimeType matches any of the allowedTypes patterns
 * @param {Array<string>} allowedTypes - Array of allowed mime types (can include wildcards)
 * @param {string} mimeType - Mime type to check
 * @returns {boolean} - True if mimeType matches any allowedTypes, false otherwise
 */
function checkMimeTypeMatch(allowedTypes, mimeType) {
  if (!allowedTypes || allowedTypes.length === 0) {
    return true
  }

  if (typeof allowedTypes === "string") {
    allowedTypes = [allowedTypes]
  }

  if (allowedTypes.includes("*/*")) {
    return true
  }

  // Remove any parameters (e.g., "; charset=utf-8", "; boundary=...")
  const baseMimeType = mimeType.split(";")[0].trim()

  return allowedTypes.some((allowedType) => {
    if (allowedType.endsWith("/*")) {
      const prefix = allowedType.slice(0, -2)
      return baseMimeType.startsWith(prefix + "/")
    } else {
      return baseMimeType === allowedType
    }
  })
}

async function computeHash(input) {
  const hash = crypto.createHash("sha256")

  // Connect the output of the `input` stream to the input of `hash`
  // and let Node.js do the streaming
  await stream.pipeline(input, hash)

  return hash.digest("hex")
}

function inferTargetCAP8(req, ref) {
  const model = cds.context?.model || cds.model

  // Extract entity/navigation names from ref array
  // Handle both simple strings and objects with .id property
  const names = ref
    .map((part) => {
      if (typeof part === "string") return part
      if (typeof part === "object" && part.id) return part.id
      return null
    })
    .filter(Boolean)

  const name = names.join(".")

  let target = model.definitions[name]
  if (!target) return null

  // draft fallback
  if (target["@odata.draft.enabled"]) {
    const draft = model.definitions[`${name}.drafts`]
    if (draft) target = draft
  }

  return target
}

const multipliers = {}
multipliers.B = 1
multipliers.KB = multipliers.B * 1024
multipliers.MB = multipliers.KB * 1024
multipliers.GB = multipliers.MB * 1024
multipliers.TB = multipliers.GB * 1024
multipliers.PB = multipliers.TB * 1024
multipliers.EB = multipliers.PB * 1024
multipliers.ZB = multipliers.EB * 1024

/**
 * Returns the maximum file size for uploads.
 * Returns -1 (no limit) when malware scanning is disabled, otherwise 400MB.
 * Evaluated at runtime to support dynamic configuration changes.
 * @returns {number} Maximum file size in bytes, or -1 for no limit
 */
function MAX_FILE_SIZE() {
  return cds.env.requires?.attachments?.scan == false ? -1 : 419430400 //400 MB in bytes
}

/**
 * Converts a byte size string into the corresponding number.
 *
 * @param {string} size 20mb for example
 * @returns Byte size or null if nothing was found
 */
function sizeInBytes(size, target) {
  if (!size || (typeof size !== "string" && typeof size !== "number")) {
    LOG.warn(
      `Could not determine the maximum byte size for the content of ${target}, falling back to default.`,
    )
    return MAX_FILE_SIZE()
  }

  if (typeof size === "number") {
    return size
  }

  const value = parseFloat(size)
  if (isNaN(value)) {
    LOG.warn(
      `Could not determine the maximum byte size for the content of ${target}, falling back to default.`,
    )
    return MAX_FILE_SIZE()
  }

  const unitMatches = size.toUpperCase().match(/([KMGTPEZ]I?)?B$/)
  // Remove any optional "i" from the unit of measurement (ex, MiB).
  const unit = unitMatches[0]?.replace(/i/i, "")

  if (!unit) {
    LOG.warn(
      `Could not determine the maximum byte size for the content of ${target}, falling back to default.`,
    )
    return MAX_FILE_SIZE()
  }

  return value * multipliers[unit]
}

/**
 * Builds a single string key from an ordered list of values for Map lookups.
 * @param {Array} values - Array of values to join
 * @returns {string}
 */
function makeTupleKey(values) {
  return values.map(String).join("\x00")
}

/**
 * Builds a CQN xpr for parent key matching.
 *   Single key:    up__ID in (val1, val2, ...)
 *   Composite key: (up__sampleID = val1 and up__gjahr = val2) or (...)
 * @param {string[]} parentKeys - The parent key column names
 * @param {object[]} tuples - Array of parent key value objects
 * @returns {object} CQN xpr object
 */
function buildParentCondition(parentKeys, tuples) {
  if (parentKeys.length === 1) {
    const key = parentKeys[0]
    return {
      xpr: [
        { ref: [key] },
        "in",
        { list: tuples.map((t) => ({ val: t[key] })) },
      ],
    }
  }
  const xpr = []
  for (const tuple of tuples) {
    if (xpr.length > 0) xpr.push("or")
    xpr.push("(")
    for (let i = 0; i < parentKeys.length; i++) {
      if (i > 0) xpr.push("and")
      xpr.push({ ref: [parentKeys[i]] }, "=", { val: tuple[parentKeys[i]] })
    }
    xpr.push(")")
  }
  return { xpr }
}

/**
 * Builds a CQN xpr for filename matching conditions.
 *   (filename = 'sample.pdf' or filename like 'sample-%.pdf') or ...
 * @param {Set<string>} incomingFilenames - Set of filenames to match
 * @returns {object} CQN xpr object
 */
function buildFilenameCondition(incomingFilenames) {
  const { extname, basename } = require("path")
  const xpr = []
  for (const filename of incomingFilenames) {
    if (xpr.length > 0) xpr.push("or")
    const base = basename(filename, extname(filename))
    const ext = extname(filename)
    xpr.push(
      "(",
      { ref: ["filename"] },
      "=",
      { val: filename },
      "or",
      { ref: ["filename"] },
      "like",
      { val: `${base}-%${ext}` },
      ")",
    )
  }
  return { xpr }
}

/**
 * Builds a DB-specific ORDER BY expression to extract the numeric suffix from filenames.
 * These use DB-native functions that cannot be abstracted by cds.ql, so they remain
 * per-dialect. The rest of the query (SELECT, WHERE, columns) is fully DB-agnostic.
 * @param {string} dbKind - The database kind ('hana', 'postgres', 'sqlite')
 * @returns {string|null} Raw SQL expression string, or null if unsupported
 */
function buildSuffixOrderBy(dbKind) {
  if (dbKind === "hana") {
    return cds.ql
      .expr`LPAD(SUBSTRING_REGEXPR('([0-9]+)(?!.*[0-9])' IN filename), 10, '0')`
  } else if (dbKind === "postgres") {
    return cds.ql
      .expr`LPAD(COALESCE(NULLIF(REGEXP_REPLACE(filename, '.*-(\\d+)\\..*', '\\1'), filename), '0'), 10, '0')`
  } else if (dbKind === "sqlite") {
    return cds.ql
      .expr`CAST(SUBSTR(filename, INSTR(filename, '-') + 1, INSTR(SUBSTR(filename, INSTR(filename, '-') + 1), '.') - 1) AS cds.Integer)`
  }
  return null
}

/**
 * Handles duplicate filename checks and renaming for a batch of attachments.
 * Performs a single database query to fetch all potential duplicates for all incoming files,
 * then renames them as needed by appending a numerical suffix.
 * @param {Array<object>} entries - The array of attachment data from the request.
 * @param {import('@sap/cds').Entity} attachmentTarget - The target attachment entity.
 * @param {Array<string>} parentKeys - The names of the parent key columns (e.g., ['up__ID']).
 */
async function handleDuplicates(entries, attachmentTarget, parentKeys) {
  if (!Array.isArray(parentKeys)) parentKeys = [parentKeys]

  const parentTupleMap = new Map()
  const incomingFilenames = new Set()

  // Collect parent IDs and incoming filenames from the request data
  for (const entry of entries) {
    if (entry.attachments && Array.isArray(entry.attachments)) {
      // Deep insert case
      const values = parentKeys.map((k) => entry[k.replace(/^up__/, "")])
      parentTupleMap.set(
        makeTupleKey(values),
        Object.fromEntries(parentKeys.map((k, i) => [k, values[i]])),
      )
      for (const att of entry.attachments) {
        if (att.filename) {
          incomingFilenames.add(att.filename)
        }
      }
    } else if (entry.filename) {
      // Single attachment case
      const values = parentKeys.map((k) => entry[k])
      parentTupleMap.set(
        makeTupleKey(values),
        Object.fromEntries(parentKeys.map((k, i) => [k, values[i]])),
      )
      incomingFilenames.add(entry.filename)
    }
  }

  if (parentTupleMap.size === 0 || incomingFilenames.size === 0) {
    return
  }

  const tuples = [...parentTupleMap.values()]
  const db = await cds.connect.to("db")

  const query = SELECT.from(attachmentTarget)
    .columns("filename", ...parentKeys)
    .where([
      buildParentCondition(parentKeys, tuples),
      "and",
      buildFilenameCondition(incomingFilenames),
    ])
    .orderBy("filename")

  const suffixOrderSql = buildSuffixOrderBy(db.kind)
  if (suffixOrderSql) {
    query.SELECT.orderBy.push({ xpr: [suffixOrderSql], sort: "desc" })
  }

  const allExistingAttachments = await query

  // Group existing filenames by compound parent key
  const existingFilenamesByParent = allExistingAttachments.reduce(
    (acc, att) => {
      const compoundKey = makeTupleKey(parentKeys.map((k) => att[k]))
      if (!acc[compoundKey]) acc[compoundKey] = new Set()
      acc[compoundKey].add(att.filename)
      return acc
    },
    {},
  )

  for (const entry of entries) {
    if (entry.attachments) {
      // Deep insert: build key from parent's own fields (no up__ prefix)
      const values = parentKeys.map((k) => entry[k.replace(/^up__/, "")])
      const tupleKey = makeTupleKey(values)
      const filenames = existingFilenamesByParent[tupleKey] || new Set()
      for (const attachment of entry.attachments) {
        parentKeys.forEach((k, i) => {
          attachment[k] = values[i]
        })
        renameFile(attachment, filenames)
        filenames.add(attachment.filename)
      }
    } else if (entry[parentKeys[0]]) {
      // Single attachment: build key from up__ fields directly
      const tupleKey = makeTupleKey(parentKeys.map((k) => entry[k]))
      const filenames = existingFilenamesByParent[tupleKey] || new Set()
      renameFile(entry, filenames)
      filenames.add(entry.filename)
    }
  }
}

/**
 * Renames a filename by appending a numerical suffix (e.g., 'file-1.txt') and modifies the data object.
 * @param {object} data - The attachment data object, which will be modified.
 * @param {Set<string>} existingFilenames - A set of filenames to check for duplicates against.
 */
function renameFile(data, existingFilenames) {
  if (!data.filename || !existingFilenames) {
    return
  }

  if (existingFilenames.has(data.filename)) {
    const ext = extname(data.filename)
    const basename =
      ext.length > 0 ? data.filename.slice(0, -ext.length) : data.filename
    let counter = 1
    let newFilename

    do {
      newFilename = `${basename}-${counter}${ext}`
      counter++
    } while (existingFilenames.has(newFilename))

    data.filename = newFilename
  }
}

function traverseEntity(root, path) {
  let current = root
  for (const part of path) {
    if (!current.elements || !current.elements[part]) return undefined
    current = current.elements[part]._target
    if (!current) return undefined
  }
  return current
}

/**
 * Builds the back-association chain from an attachment entity up to the root entity
 * by walking the composition path top-down and discovering the back-association name
 * at each level.
 *
 * The result is reversed so it represents the navigation path from the leaf (attachment)
 * back up to the root entity.
 *
 * Example: For root=Test, path=["details", "attachments"]
 *   - Test -> details: back-assoc in TestDetails is "test"
 *   - TestDetails -> attachments: back-assoc in Attachments is "up_"
 *   - Chain (root→leaf): ["test", "up_"]
 *   - Reversed (leaf→root): ["up_", "test"]
 *
 * @param {import('@sap/cds').entity} rootEntity - The draft-leading root entity definition
 * @param {string[]} compositionPath - Array of composition element names from root to leaf
 * @returns {string[]} - Reversed array of back-association names (from leaf up to root)
 */
function buildBackAssocChain(rootEntity, compositionPath) {
  if (!rootEntity || !compositionPath || compositionPath.length === 0) {
    return ["up_"]
  }
  const chain = []
  let current = rootEntity
  for (const compName of compositionPath) {
    const comp = current.compositions && current.compositions[compName]
    if (!comp || !comp._target) return chain.reverse()
    const target = comp._target
    // Find the back-association: an association in the target whose _target is the current entity
    let backAssocName = null
    if (target.elements) {
      for (const [elemName, elem] of Object.entries(target.elements)) {
        if (
          elem.type === "cds.Association" &&
          elem._target &&
          elem._target.name === current.name
        ) {
          backAssocName = elemName
          break
        }
      }
    }
    if (backAssocName) {
      chain.push(backAssocName)
    }
    current = target
  }
  return chain.reverse()
}

/**
 * Creates a size checking handler for streams that aborts upload when size limit is exceeded
 * @param {Object} options - Configuration options
 * @param {number} options.maxFileSize - Maximum allowed file size in bytes (-1 for no limit)
 * @param {string} options.filename - Filename for error message
 * @param {string} options.sizeLimit - Human-readable size limit for error message (e.g., "400MB")
 * @param {Function} options.onSizeExceeded - Callback when size is exceeded (receives no arguments)
 * @returns {{ handler: Function, getSizeExceeded: Function, createError: Function }}
 */
function createSizeCheckHandler({
  maxFileSize,
  filename,
  sizeLimit,
  onSizeExceeded,
}) {
  let uploadedSize = 0
  let sizeExceeded = false

  const handler = (chunk) => {
    if (maxFileSize === -1 || sizeExceeded) return
    uploadedSize += chunk.length
    if (uploadedSize > maxFileSize) {
      sizeExceeded = true
      onSizeExceeded?.()
    }
  }

  const getSizeExceeded = () => sizeExceeded

  const createError = () => {
    const error = new Error("AttachmentSizeExceeded")
    error.code = 413
    error.status = 413
    error.args = [filename || "n/a", sizeLimit]
    return error
  }

  return { handler, getSizeExceeded, createError }
}

module.exports = {
  fetchToken,
  getObjectStoreCredentials,
  computeHash,
  sizeInBytes,
  fetchObjectStoreBinding,
  validateServiceManagerCredentials,
  checkMimeTypeMatch,
  traverseEntity,
  buildBackAssocChain,
  MAX_FILE_SIZE,
  inferTargetCAP8,
  getAttachmentKind,
  handleDuplicates,
  createSizeCheckHandler,
}
