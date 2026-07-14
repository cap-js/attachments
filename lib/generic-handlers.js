const cds = require("@sap/cds")
const LOG = cds.log("attachments")
const { extname } = require("path")
const { MAX_FILE_SIZE, sizeInBytes, checkMimeTypeMatch } = require("./helper")
const { getMime } = require("./mime")

/**
 * Finalizes the preparation of a single attachment's data
 * @param {object} data - The attachment data
 * @param {import('@sap/cds').Request} req - The request object
 */
async function finalizePrepareAttachment(data, req, prefix) {
  const attachmentData = prefix ? {} : data
  if (prefix) {
    for (const key in data) {
      // When prefix is set, attachmentData is a fresh object, so this guard only
      // fires if the source data had a `${prefix}_url` key — which is intentional.
      if (key.startsWith(prefix)) {
        attachmentData[key.substring(prefix.length + 1)] = data[key]
      }
    }
  }

  if (req?.data === data && "url" in attachmentData) {
    delete attachmentData.url
  }

  const hasUpKey = Object.keys(attachmentData).some((key) =>
    key.startsWith("up__"),
  )

  if (!hasUpKey) {
    const parentRef = req.subject.ref.slice(0, -1)

    // Only try to populate parent keys if there is a parent reference
    if (parentRef && parentRef.length > 0) {
      let target
      target = cds.infer.target({ SELECT: { from: { ref: parentRef } } })

      if (target?.keys) {
        LOG.info(`Populating parent keys for attachment upload`, target)
        const parentKeys = Object.keys(target.keys)
        const parentRecord = await SELECT.one
          .from({ ref: parentRef })
          .columns(parentKeys)

        for (const key of parentKeys) {
          attachmentData[`up__${key}`] = parentRecord[key]
        }
      } else {
        LOG.warn(
          `Could not determine parent target for attachment upload. ParentRef: ${JSON.stringify(parentRef)}`,
        )
      }
    }
  }

  if (!attachmentData.url) {
    const attachment = await cds.connect.to("attachments")
    // Generate URL for object store
    attachmentData.url = await attachment.createUrlForAttachment(attachmentData)
  }
  attachmentData.ID ??= cds.utils.uuid()

  let ext = attachmentData.filename
    ? extname(attachmentData.filename).toLowerCase().slice(1)
    : null
  attachmentData.mimeType = getMime(ext)

  if (!attachmentData.mimeType) {
    LOG.warn(
      `An attachment ${attachmentData.ID} is uploaded whose extension "${ext}" is not known! Falling back to "application/octet-stream"`,
    )
    attachmentData.mimeType = "application/octet-stream"
  }

  if (prefix) {
    for (const key in attachmentData) {
      data[`${prefix}_${key}`] = attachmentData[key]
    }
  }
}

/**
 * Traverses the composition path to prepare attachment data
 * @param {object} data - The attachment data
 * @param {Array} comps - The composition path for a single attachment entity
 * @param {import('@sap/cds').Request} req - The request object
 */
async function traverseReqData(data, comps, req) {
  if (comps.length === 0 || !data[comps[0]]) return
  if (comps.length === 1) {
    for (const dataItem of data[comps[0]]) {
      await finalizePrepareAttachment(dataItem, req)
    }
    return
  }
  if (data[comps[0]] instanceof Array) {
    for (const dataItem of data[comps[0]]) {
      await traverseReqData(dataItem, comps.slice(1), req)
    }
  } else {
    await traverseReqData(data[comps[0]], comps.slice(1), req)
  }
}

/**
 * Prepares the attachment data before creation
 * @param {import('@sap/cds').Request} req - The request object
 */
async function onPrepareAttachment(req) {
  if (
    !req.target?._attachments?.isAttachmentsEntity &&
    !req.target?._attachments?.hasAttachmentsComposition &&
    !req.target?._attachments?.hasInlineAttachments
  )
    return

  if (req.target._attachments.isAttachmentsEntity) {
    await finalizePrepareAttachment(req.data, req)
  } else {
    if (req.target?._attachments?.hasAttachmentsComposition) {
      const attachmentCompositions =
        req?.target?._attachments.attachmentCompositions
      for (const attachmentsComp of attachmentCompositions) {
        await traverseReqData(req.data, attachmentsComp, req)
      }
    }
    if (req.target?._attachments?.hasInlineAttachments) {
      for (const prefix of req.target?._attachments?.inlineAttachmentPrefixes ??
        []) {
        if (req.data[`${prefix}_content`]) {
          await finalizePrepareAttachment(req.data, req, prefix)
        }
      }
    }
  }
}

/**
 * Resolves scan status information for an attachment content request.
 * For composition-based entities, delegates to AttachmentsSrv.getStatus.
 * For single inline attachments, queries the parent record directly.
 * @param {import('@sap/cds').Request} req - The request object
 * @param {string} reqUrl - The request URL
 * @param {object} AttachmentsSrv - The attachments service instance
 * @returns {Promise<{ status: string, lastScan: string, attachmentId: string, inlineUrl?: string, prefix?: string }>}
 */
async function getScanInfo(req, reqUrl, AttachmentsSrv) {
  if (req.target._attachments.isAttachmentsEntity) {
    const id = req.data.ID || req.params?.at(-1).ID
    const { status, lastScan } = await AttachmentsSrv.getStatus(req.target, {
      ID: id,
    })
    return { status, lastScan, attachmentId: id }
  }

  const prefix = reqUrl.split("/").pop().replace("_content", "")
  const dbKeys = Object.fromEntries(
    Object.entries(req.target.keys)
      .map(([key]) => [
        key,
        req.data[key] || req.params.find((p) => p[key])?.[key],
      ])
      .filter(([k, v]) => v !== undefined && k !== "IsActiveEntity"),
  )

  const parentRecord = await SELECT.one
    .from(req.target, dbKeys)
    .columns(`${prefix}_status`, `${prefix}_lastScan`, `${prefix}_url`)
  if (!parentRecord) return req.reject(404)

  const inlineUrl = parentRecord[`${prefix}_url`]
  if (!inlineUrl) return req.reject(404)

  return {
    status: parentRecord[`${prefix}_status`],
    lastScan: parentRecord[`${prefix}_lastScan`],
    attachmentId: dbKeys.ID,
    inlineUrl,
    prefix,
  }
}

/**
 * Enforces malware scan policy for an attachment download.
 * Rejects the request or triggers a rescan based on scan status and expiry.
 * @param {import('@sap/cds').Request} req - The request object
 * @param {{ status: string, lastScan: string, attachmentId: string, inlineUrl?: string, prefix?: string }} scanInfo
 */
async function enforceScanPolicy(
  req,
  { status, lastScan, attachmentId, inlineUrl, prefix },
) {
  const scanExpiryMs =
    cds.env.requires?.attachments?.scanExpiryMs ?? 3 * 24 * 60 * 60 * 1000

  if (status === "Unscanned")
    return await rescan(req, attachmentId, prefix, inlineUrl)

  if (status !== "Clean") {
    const ipAddress = req.req?.ip
    const forwardedIp = req.req?.headers?.["x-forwarded-for"]
    cds.spawn(async () => {
      try {
        const srv = await cds.connect.to("attachments")
        await srv.emit("AttachmentDownloadRejected", {
          target: req.target.name,
          keys: { ID: attachmentId },
          status,
          ipAddress,
          forwardedIp,
        })
      } catch (err) {
        LOG.error("Failed to emit AttachmentDownloadRejected", err)
      }
    })
    req.reject(403, "UnableToDownloadAttachmentScanStatusNotClean")
  }

  if (
    scanExpiryMs !== -1 &&
    (!lastScan || Date.now() - new Date(lastScan).getTime() > scanExpiryMs)
  ) {
    return rescan(req, attachmentId, prefix, inlineUrl)
  }
}

/**
 * Validates if the attachment can be accessed based on its malware scan status
 * @param {import('@sap/cds').Request} req - The request object
 */
async function validateAttachment(req) {
  if (
    !req.target?._attachments?.isAttachmentsEntity &&
    !req.target?._attachments?.hasInlineAttachments
  )
    return

  /* removing case condition for mediaType annotation as in our case binary value and metadata is stored in different database */
  if (req.target?._attachments?.isAttachmentsEntity) {
    req?.query?.SELECT?.columns?.forEach((element) => {
      if (element.as === "content@odata.mediaContentType" && element.xpr) {
        delete element.xpr
        element.ref = ["mimeType"]
      }
    })
  }

  if (req.target?._attachments?.hasInlineAttachments) {
    for (const prefix of req.target._attachments.inlineAttachmentPrefixes) {
      req?.query?.SELECT?.columns?.forEach((element) => {
        if (
          element.as === `${prefix}_content@odata.mediaContentType` &&
          element.xpr
        ) {
          // With object store, content is always null —> use url instead to detect if a file exists
          element.xpr = element.xpr.map((part) =>
            part?.ref?.[0] === `${prefix}_content`
              ? { ref: [`${prefix}_url`] }
              : part,
          )
        }
      })
    }
  }

  const reqUrl = req?.req?.url

  if (reqUrl?.endsWith("/content") || /\/[^/]*_content$/.test(reqUrl)) {
    const AttachmentsSrv = await cds.connect.to("attachments")

    const scanInfo = await getScanInfo(req, reqUrl, AttachmentsSrv)
    if (scanInfo.status == null) return req.reject(404)

    if (cds.env.requires?.attachments?.scan ?? true)
      await enforceScanPolicy(req, scanInfo)
  }
}

/**
 * Triggers a malware rescan for an attachment and rejects the current request with 202.
 * Updates the scan status to "Scanning" before emitting the scan event to prevent race conditions.
 * @param {import('@sap/cds').Request} req - The request object
 * @param {string} attachmentId - The ID of the attachment to rescan
 * @param {string} [prefix] - The field prefix for inline attachments; undefined for composition-based entities
 * @param {string} [url] - The object store URL for inline attachments
 */
async function rescan(req, attachmentId, prefix, url) {
  LOG.debug(
    `Attachment ${attachmentId} scan has expired or no lastScan date. Triggering re-scan.`,
  )

  const target = req.target.name,
    keys = { ID: attachmentId }

  // No scan or scan expired: trigger scan and reject
  const malwareScanner = await cds.connect.to("malwareScanner")

  if (req.target?._attachments?.isAttachmentsEntity) {
    // Set status to Scanning and commit before emitting event to prevent race conditions
    cds.tx(
      async () => await malwareScanner.updateStatus(target, keys, "Scanning"),
    )
    // Trigger scanning in separate transaction as req.reject closes the current transaction
    cds.spawn(
      async () =>
        await malwareScanner.emit("ScanAttachmentsFile", {
          target,
          keys,
        }),
    )
  } else {
    cds.tx(
      async () =>
        await UPDATE(req.target, keys).set({
          [`${prefix}_status`]: "Scanning",
        }),
    )
    cds.spawn(
      async () =>
        await malwareScanner.emit("ScanAttachmentsFile", {
          target: req.target.name,
          keys,
          prefix,
          url,
        }),
    )
  }

  // req.reject does not accept status codes below 400, so we throw the error directly
  throw cds.error({
    status: 202,
    code: "UnableToDownloadAttachmentScanStatusExpired",
  })
}

/**
 * Reads the attachment content if requested
 * @param {[import('@sap/cds').Entity]} param0
 * @param {import('@sap/cds').Request} req - The request object
 */
async function readAttachment([attachment], req) {
  if (
    !req.target?._attachments?.isAttachmentsEntity &&
    !req.target?._attachments?.hasInlineAttachments
  )
    return

  if (
    req._.readAfterWrite ||
    !(
      req?.req?.url?.endsWith("/content") || req?.req?.url?.match(/_content$/)
    ) ||
    !attachment
  )
    return

  const AttachmentsSrv = await cds.connect.to("attachments")

  if (req.target?._attachments?.isAttachmentsEntity) {
    if (attachment.content) return
    attachment.content = await AttachmentsSrv.get(
      req.target,
      { ID: req.data.ID ?? req.params.at(-1).ID },
      null,
    )
  } else {
    const prefix = req.req.url.split("/").pop().replace("_content", "")
    const contentField = `${prefix}_content`
    if (attachment[contentField]) return
    const parentKeys = Object.fromEntries(
      Object.entries(req.target.keys)
        .filter(([key]) => key !== "IsActiveEntity")
        .map(([key]) => [key, attachment[key]]),
    )
    const record = await SELECT.one
      .from(req.target, parentKeys)
      .columns(`${prefix}_url as url`)
    if (!record?.url)
      return req.reject(404, "No content available for this attachment")
    attachment[contentField] = await AttachmentsSrv.get(
      req.target,
      parentKeys,
      record.url,
      prefix,
    )
  }
}

/**
 * Resolves the content element, content value, and field prefix for the current request.
 * For single inline attachments, returns null if no matching prefix is found.
 * @param {import('@sap/cds').Request} req - The request object
 * @returns {{ element: object, content: any, prefix: string | undefined } | null}
 */
function resolveAttachmentContext(req) {
  if (req.target._attachments.isAttachmentsEntity) {
    return {
      element: req.target.elements.content,
      content: req.data.content ?? req.req?.body?.content,
      prefix: undefined,
    }
  }

  const prefix = req.target._attachments.inlineAttachmentPrefixes.find(
    (p) =>
      req.data[`${p}_content`] ||
      req.headers["content-disposition"]?.includes(`name="${p}_content"`),
  )
  if (!prefix) return null

  return {
    element: req.target.elements[`${prefix}_content`],
    content: req.data[`${prefix}_content`],
    prefix,
  }
}

/**
 * Resolves the filename for the attachment being uploaded.
 * Falls back to a DB lookup if the filename is not present in the request data.
 * @param {import('@sap/cds').Request} req - The request object
 * @param {string | undefined} prefix - Field prefix for inline attachments; undefined for composition-based entities
 * @returns {Promise<string>}
 */
async function resolveFilename(req, prefix) {
  if (!prefix) {
    const attachmentId = req.data.ID ?? req.params?.at(-1)?.ID
    const attachmentRef = attachmentId
      ? await SELECT.one("filename")
          .from(req.target)
          .where({ ID: attachmentId })
      : null
    return req.data.filename ?? attachmentRef?.filename ?? "n/a"
  }

  const filename = req.data[`${prefix}_filename`] ?? null
  if (filename) return filename

  const dbKeys = Object.fromEntries(
    Object.entries(req.params?.at(-1) || {}).filter(
      ([k]) => k !== "IsActiveEntity",
    ),
  )
  const record = await SELECT.one
    .from(req.target.drafts || req.target, dbKeys)
    .columns(`${prefix}_filename`)
  return record?.[`${prefix}_filename`] ?? "n/a"
}

/**
 * Checks the attachments size against the maximum defined by the annotation `@Validation.Maximum`. Default 400mb.
 * If the limit is reached by the reported size of the content-length header or if the stream length exceeds
 * the limits the error is thrown.
 * @param {import('@sap/cds').Request} req - The request object
 * @throws AttachmentSizeExceeded
 */
async function validateAttachmentSize(req, validateContentLength = false) {
  if (
    !req.target?._attachments?.isAttachmentsEntity &&
    !req.target?._attachments?.hasInlineAttachments
  )
    return false

  const ctx = resolveAttachmentContext(req)
  if (!ctx) return false

  if (!ctx.content && !validateContentLength) return false

  const maxFileSize = ctx.element["@Validation.Maximum"]
    ? (sizeInBytes(ctx.element["@Validation.Maximum"], req.target.name) ??
      MAX_FILE_SIZE)
    : MAX_FILE_SIZE

  const isInMemory =
    ctx.content != null && typeof ctx.content.length === "number"

  if (!validateContentLength && !isInMemory) {
    if (
      req.headers["content-length"] == null ||
      req.headers["content-length"] === ""
    ) {
      return true
    }

    if (isNaN(Number(req.headers["content-length"]))) {
      req.reject(400, "InvalidContentLengthHeader", {
        contentLength: req.headers["content-length"],
      })
    }
  }

  const length =
    validateContentLength || isInMemory
      ? ctx.content.length
      : Number(req.headers["content-length"])

  if (length > maxFileSize) {
    if (ctx.content?.pause) {
      ctx.content.pause()
    }

    const filename = await resolveFilename(req, ctx.prefix)
    const ipAddress = req.req?.ip
    const forwardedIp = req.req?.headers?.["x-forwarded-for"]
    cds.spawn(async () => {
      try {
        const AttachmentsSrv = await cds.connect.to("attachments")
        await AttachmentsSrv.emit("AttachmentSizeExceeded", {
          target: req.target.name,
          keys: req.data.ID ? { ID: req.data.ID } : {},
          filename,
          fileSize: length,
          maxFileSize,
          ipAddress,
          forwardedIp,
        })
      } catch (err) {
        LOG.error("Failed to emit AttachmentSizeExceeded", err)
      }
    })

    req.reject({
      status: 413,
      message: "AttachmentSizeExceeded",
      args: [filename, ctx.element["@Validation.Maximum"] ?? "400MB"],
    })
    return false
  }
  return true
}

/**
 * Validates the attachment mime type against acceptable media types
 * @param {import('@sap/cds').Request} req - The request object
 */
function validateAttachmentMimeType(req) {
  if (
    !req.target?._attachments?.isAttachmentsEntity &&
    !req.target?._attachments?.hasInlineAttachments
  )
    return false

  let mimeType, element
  if (req.target?._attachments?.isAttachmentsEntity) {
    if (!req.data.content) return false
    element = req.target.elements.content
    mimeType = req.data.mimeType
  } else {
    const prefix = req.target?._attachments?.inlineAttachmentPrefixes.find(
      (p) =>
        req.data[`${p}_content`] ||
        req.headers["content-disposition"]?.includes(`name="${p}_content"`),
    )
    if (!prefix) return false

    element = req.target.elements[`${prefix}_content`]
    mimeType = req.data[`${prefix}_mimeType`]
  }

  const acceptableMediaTypes = element["@Core.AcceptableMediaTypes"] || "*/*"
  if (!checkMimeTypeMatch(acceptableMediaTypes, mimeType)) {
    const ipAddress = req.req?.ip
    const forwardedIp = req.req?.headers?.["x-forwarded-for"]
    cds.spawn(async () => {
      try {
        const AttachmentsSrv = await cds.connect.to("attachments")
        await AttachmentsSrv.emit("AttachmentUploadRejected", {
          target: req.target.name,
          keys: req.data.ID ? { ID: req.data.ID } : {},
          filename: req.data.filename,
          mimeType,
          acceptableMediaTypes,
          reason: `MIME type '${mimeType}' is not in @Core.AcceptableMediaTypes`,
          ipAddress,
          forwardedIp,
        })
      } catch (err) {
        LOG.error("Failed to emit AttachmentUploadRejected", err)
      }
    })
    req.reject(400, "AttachmentMimeTypeDisallowed", {
      mimeType: mimeType,
    })
    return false
  }
  return true
}

/**
 * Validates and uploads attachment content intercepted at the DB layer.
 * Used to handle attachment INSERT operations via the attachments service
 * instead of writing content directly to the database.
 * @param {object} data - The attachment data from the INSERT
 * @param {import('@sap/cds').Entity} target - The target entity
 * @param {import('@sap/cds').Request} req - The request object
 */
async function validateAndInsertAttachmentFromDBHandler(data, target, req) {
  if (!target._attachments) return

  if (target._attachments.isAttachmentsEntity) {
    if (!data.content) return
    if (!validateAttachmentMimeType({ data, target, reject: req.reject }))
      return
    if (
      !(await validateAttachmentSize(
        { data, target, reject: req.reject },
        true,
      ))
    )
      return

    data.url = cds.utils.uuid()
    const attachment = await cds.connect.to("attachments")
    await attachment.put(target, data)
  } else if (target._attachments.hasInlineAttachments) {
    for (const prefix of target._attachments.inlineAttachmentPrefixes) {
      if (data[`${prefix}_content`]) {
        const attachmentData = {
          content: data[`${prefix}_content`],
          mimeType: data[`${prefix}_mimeType`],
          filename: data[`${prefix}_filename`],
        }

        const attachmentTarget =
          cds.model.definitions["sap.attachments.Attachment"]
        if (
          !validateAttachmentMimeType({
            data: attachmentData,
            target: attachmentTarget,
            reject: req.reject,
          })
        )
          continue
        if (
          !(await validateAttachmentSize(
            {
              data: attachmentData,
              target: attachmentTarget,
              reject: req.reject,
            },
            true,
          ))
        )
          continue

        data[`${prefix}_url`] = cds.utils.uuid()
        attachmentData.url = data[`${prefix}_url`]

        const attachmentService = await cds.connect.to("attachments")
        await attachmentService.put(attachmentTarget, attachmentData)
        delete data[`${prefix}_content`]
      }
    }
  }
}

module.exports = {
  validateAttachmentSize,
  onPrepareAttachment,
  readAttachment,
  validateAttachment,
  validateAttachmentMimeType,
  validateAndInsertAttachmentFromDBHandler,
}
