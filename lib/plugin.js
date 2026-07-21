const cds = require("@sap/cds")
const {
  validateAttachment,
  readAttachment,
  validateAttachmentSize,
  onPrepareAttachment,
  validateAttachmentMimeType,
  validateAndInsertAttachmentFromDBHandler,
} = require("./generic-handlers")
const { getAttachmentKind, handleDuplicates } = require("./helper")
require("./csn-runtime-extension")
const LOG = cds.log("attachments")

cds.on("compile.to.edmx", unfoldModel)

// Register the db handler ONCE (not per-service) to intercept attachment INSERT
// and handle it through the attachments service instead of native DB insert
// NOTE: Must be synchronous - avoid await inside 'served' handler as emit is synchronous
// NOTE: Database services use INSERT/UPDATE/DELETE/SELECT events, not CREATE/READ etc.
// NOTE: Must use db.prepend() to ensure handlers run before existing ones
cds.once("served", () => {
  if (!cds.env.requires.attachments) return
  if (cds.env.requires.attachments?.outbox !== undefined) {
    LOG.warn(
      "`cds.requires.attachments.outbox` is deprecated; use `queue` instead.",
    )
  }
  const { db } = cds.services

  db.prepend(() => {
    db.on("INSERT", async function handleDBInsert(req, next) {
      // Only intercept attachment entities with content, when not using db storage
      if (
        !req.data ||
        (!req?.target?._attachments?.isAttachmentsEntity &&
          !req?.target?._attachments?.hasInlineAttachments) ||
        getAttachmentKind() === "db"
      ) {
        return next()
      }

      const entries = req.data instanceof Array ? req.data : [req.data]
      const prefixes = req.target._attachments.inlineAttachmentPrefixes || []

      // Check if any entry has content - if not, let native INSERT handle it
      const hasContent = entries.some(
        (entry) =>
          (entry.content && entry.content.on) ||
          prefixes.some((prefix) => entry[`${prefix}_content`]),
      )
      if (!hasContent) {
        return next()
      }

      LOG.info("Intercepting DB INSERT for attachments", {
        target: req.target.name,
        entryCount: entries.length,
      })

      // Process each entry through the attachments service
      for (const entry of entries) {
        await validateAndInsertAttachmentFromDBHandler(entry, req.target, req)
      }

      // Return the data as the result (attachment.put handles the actual storage)
      return next()
    })

    /**
     * Fetches binary content from object storage for composition-based attachment items
     * that have an ID but no content loaded. Removes the ID from results if it was added
     * only to enable the fetch and was not part of the original SELECT columns.
     * @param {object[]} items - The result rows to hydrate with content
     * @param {import('@sap/cds').entity} target - The attachment entity definition
     * @param {object} AttachmentsSrv - The attachments service instance
     * @param {boolean} idMissingFromColumns - Whether ID was injected into the query and should be removed from results
     */
    async function fetchCompositionContent(
      items,
      target,
      AttachmentsSrv,
      idMissingFromColumns,
    ) {
      await Promise.all(
        items.map(async (attachment) => {
          if (attachment?.ID && !attachment.content) {
            try {
              attachment.content = await AttachmentsSrv.get(target, {
                ID: attachment.ID,
              })
            } catch (err) {
              LOG.error("Failed to fetch content from object storage", {
                ID: attachment.ID,
                err,
              })
            }
          }
          if (idMissingFromColumns && attachment) delete attachment.ID
        }),
      )
    }

    /**
     * Fetches binary content from object storage for inline attachment fields that have a URL
     * but no content loaded. Cleans up any extra columns that were injected into the SELECT
     * solely to enable the fetch (URLs and entity keys not originally requested).
     * @param {object[]} items - The result rows to hydrate with content
     * @param {import('@sap/cds').entity} target - The parent entity definition
     * @param {object} AttachmentsSrv - The attachments service instance
     * @param {string[]} activePrefixes - Inline attachment field prefixes that need content
     * @param {object} keys - The entity key definitions from target.keys
     * @param {Array<{ref: [string]}>} inlineColsToAdd - Extra columns that were injected and must be removed from results
     */
    async function fetchInlineContent(
      items,
      target,
      AttachmentsSrv,
      activePrefixes,
      keys,
      inlineColsToAdd,
    ) {
      await Promise.all(
        items.map(async (attachment) => {
          if (!attachment) return
          const entityKeys = Object.fromEntries(
            Object.keys(keys)
              .filter((k) => k !== "IsActiveEntity")
              .map((k) => [k, attachment[k]]),
          )
          for (const prefix of activePrefixes) {
            if (
              !attachment[`${prefix}_content`] &&
              attachment[`${prefix}_url`]
            ) {
              try {
                attachment[`${prefix}_content`] = await AttachmentsSrv.get(
                  target,
                  entityKeys,
                  attachment[`${prefix}_url`],
                  prefix,
                )
              } catch (err) {
                LOG.error("Failed to fetch content from object storage", {
                  keys: entityKeys,
                  err,
                })
              }
            }
          }
          for (const {
            ref: [col],
          } of inlineColsToAdd)
            delete attachment[col]
        }),
      )
    }

    db.on("SELECT", async function handleDBSelectForContent(req, next) {
      const columns = req.query?.SELECT?.columns
      if (
        !Array.isArray(columns) ||
        (!req.target?._attachments?.isAttachmentsEntity &&
          !req?.target?._attachments?.hasInlineAttachments) ||
        getAttachmentKind() === "db"
      )
        return next()

      const isComposition = req.target._attachments.isAttachmentsEntity
      if (!isComposition && cds.context?.http?.req) return next()
      const activePrefixes = isComposition
        ? null
        : req.target._attachments.inlineAttachmentPrefixes.filter((p) =>
            columns.some((c) => c?.ref?.[0] === `${p}_content`),
          )
      const hasContentColumn = isComposition
        ? columns.some((c) => c?.ref?.[0] === "content")
        : activePrefixes.length > 0
      if (!hasContentColumn) return next()

      const idMissingFromColumns =
        isComposition && !columns.some((c) => c?.ref?.[0] === "ID")
      const inlineColsToAdd = isComposition
        ? []
        : [
            ...activePrefixes
              .filter((p) => !columns.some((c) => c?.ref?.[0] === `${p}_url`))
              .map((p) => ({ ref: [`${p}_url`] })),
            ...Object.keys(req.target.keys)
              .filter(
                (k) =>
                  k !== "IsActiveEntity" &&
                  !columns.some((c) => c?.ref?.[0] === k),
              )
              .map((k) => ({ ref: [k] })),
          ]
      if (idMissingFromColumns)
        req.query.SELECT.columns = [...columns, { ref: ["ID"] }]
      else if (inlineColsToAdd.length > 0)
        req.query.SELECT.columns = [...columns, ...inlineColsToAdd]

      let results
      try {
        results = await next()
      } finally {
        if (req.query.SELECT.columns !== columns)
          req.query.SELECT.columns = columns
      }

      if (!results) return results

      const items = Array.isArray(results) ? results : [results]
      if (items.length === 0) return results
      const needsFetch = isComposition
        ? items.some((a) => a?.ID && !a.content)
        : items.some(
            (a) =>
              a &&
              activePrefixes.some((p) => !a[`${p}_content`] && a[`${p}_url`]),
          )
      if (!needsFetch) return results

      const AttachmentsSrv = await cds.connect.to("attachments")
      if (isComposition) {
        await fetchCompositionContent(
          items,
          req.target,
          AttachmentsSrv,
          idMissingFromColumns,
        )
      } else {
        await fetchInlineContent(
          items,
          req.target,
          AttachmentsSrv,
          activePrefixes,
          req.target.keys,
          inlineColsToAdd,
        )
      }
      return results
    })
  })
})

/**
 * Unfold the model to add necessary facets for attachments
 * @param {*} csn - CSN model
 */
function unfoldModel(csn) {
  const meta = (csn.meta ??= {})
  if (!("sap.attachments.Attachments" in csn.definitions)) return
  if (meta._enhanced_for_attachments) return
  // const csnCopy = structuredClone(csn) // REVISIT: Why did we add this cloning?
  const hasFacetForComp = (name, facets) =>
    facets.some(
      (f) =>
        f.Target === `${name}/@UI.LineItem` ||
        (f.Facets && hasFacetForComp(name, f.Facets)),
    )
  cds.linked(csn).forall("entity", (entity) => {
    const facets = entity["@UI.Facets"]

    for (const [name, comp] of Object.entries(entity.compositions ?? {})) {
      if (!comp._target?.["@_is_media_data"] || !comp.is2many) continue
      if (comp["@attachments.disable_facet"] !== undefined)
        LOG.warn(
          `@attachments.disable_facet is deprecated! Please annotate ${name} with @UI.Hidden`,
        )
      if (
        !facets ||
        comp["@attachments.disable_facet"] ||
        hasFacetForComp(name, facets)
      )
        continue

      LOG.debug(`Adding @UI.Facet to: ${entity.name}`)
      const attachmentsFacet = {
        $Type: "UI.ReferenceFacet",
        Target: `${name}/@UI.LineItem`,
        ID: `${name}_attachments`,
        Label: "{i18n>Attachments}",
      }
      if (comp["@UI.Hidden"])
        attachmentsFacet["@UI.Hidden"] = comp["@UI.Hidden"]
      facets.push(attachmentsFacet)
      // Hide parent key so it cannot be selected from Columns on the UI
      Object.keys(comp._target.elements)
        .filter((e) => e.startsWith("up__"))
        .forEach((e) => {
          comp._target.elements[e]["@UI.Hidden"] = true
        })
      if (comp._target.elements["up_"])
        comp._target.elements["up_"]["@UI.Hidden"] = true
    }

    for (const prefix of entity._attachments?.inlineAttachmentPrefixes ?? []) {
      const contentElement = entity.elements?.[`${prefix}_content`]
      if (
        !contentElement ||
        contentElement["@Core.ContentDisposition.Filename"]
      )
        continue
      contentElement["@Core.ContentDisposition.Filename"] = {
        "=": `${prefix}_filename`,
      }
      contentElement["@Core.ContentDisposition.Type"] = "inline"

      const fieldGroupKey = `@UI.FieldGroup#${prefix}`
      const alreadyConfigured = Object.keys(entity).some(
        (k) =>
          k.startsWith("@UI.FieldGroup#") &&
          k.slice("@UI.FieldGroup#".length).toLowerCase() ===
            prefix.toLowerCase(),
      )
      if (
        !facets ||
        alreadyConfigured ||
        facets.some((f) => f.Target === fieldGroupKey)
      )
        continue

      LOG.debug(
        `Adding @UI.FieldGroup and @UI.Facet for inline attachment to: ${entity.name}`,
      )
      entity[fieldGroupKey] = {
        $Type: "UI.FieldGroupType",
        Data: [
          { $Type: "UI.DataField", Value: { "=": `${prefix}_content` } },
          { $Type: "UI.DataField", Value: { "=": `${prefix}_filename` } },
          { $Type: "UI.DataField", Value: { "=": `${prefix}_status` } },
        ],
      }
      const label =
        entity._attachments.inlineAttachmentPrefixes.length > 1
          ? prefix
          : "{i18n>Attachment}"
      facets.push({
        $Type: "UI.ReferenceFacet",
        ID: `${prefix}_attachment`,
        Target: fieldGroupKey,
        Label: label,
      })
    }
  })
  meta._enhanced_for_attachments = true
}

cds.ApplicationService.handle_attachments = cds.service.impl(async function () {
  if (!cds.env.requires.attachments) return
  LOG.debug(
    `Registering handlers for attachments entities for service: ${this.name}`,
  )
  this.before("READ", validateAttachment)
  this.after("READ", readAttachment)
  this.before("PUT", validateAttachmentSize)
  this.before("POST", validateAttachmentMimeType)
  this.before("POST", validateAttachmentSize)
  this.before("NEW", onPrepareAttachment)
  this.before("CREATE", async (req) => {
    if (cds.env.requires.attachments?.deduplicateFileNames === true) {
      const entries = Array.isArray(req.data) ? req.data : [req.data]
      const attachmentComps = Object.entries(
        req.target?.compositions || {},
      ).filter(([, comp]) => comp._target?.["@_is_media_data"])

      const targets =
        attachmentComps.length > 0
          ? attachmentComps.map(([name, comp]) => ({
              name,
              target: comp._target,
            }))
          : [{ name: undefined, target: req.target }]

      for (const {
        name: attachmentCompName,
        target: attachmentTarget,
      } of targets) {
        if (!attachmentTarget?.elements) continue
        const parentKeyColumn = Object.keys(attachmentTarget.elements).filter(
          (k) => k.startsWith("up__"),
        )
        if (parentKeyColumn.length > 0) {
          await handleDuplicates(
            entries,
            attachmentTarget,
            parentKeyColumn,
            attachmentCompName,
          )
        }
      }
    }
    return onPrepareAttachment(req)
  })

  this.before(["PUT", "UPDATE"], (req) => {
    if (req.target?._attachments?.isAttachmentsEntity && "url" in req.data) {
      delete req.data.url
    }
    if (
      req.target?._attachments?.hasInlineAttachments &&
      req._?.event !== "draftActivate"
    ) {
      for (const prefix of req.target._attachments.inlineAttachmentPrefixes) {
        if (
          `${prefix}_content` in req.data &&
          req.data[`${prefix}_content`] === null
        ) {
          // User deleted the attachment — null out all protected fields
          req.data[`${prefix}_url`] = null
          req.data[`${prefix}_filename`] = null
          req.data[`${prefix}_status`] = "Unscanned"
          req.data[`${prefix}_hash`] = null
          req.data[`${prefix}_lastScan`] = null
          req.data[`${prefix}_mimeType`] = null
        } else {
          delete req.data[`${prefix}_url`]
        }
      }
    }
  })

  this.before(
    ["DELETE", "UPDATE"],
    async function collectDeletedAttachmentsForDraftEnabled(req) {
      if (
        !req.target?._attachments?.hasAttachmentsComposition &&
        !req.target?._attachments?.hasInlineAttachments
      )
        return
      const AttachmentsSrv = await cds.connect.to("attachments")
      return AttachmentsSrv.attachDeletionData.bind(AttachmentsSrv)(req)
    },
  )
  this.after(
    ["DELETE", "UPDATE"],
    async function deleteCollectedDeletedAttachmentsForDraftEnabled(res, req) {
      if (
        !req.target?._attachments?.hasAttachmentsComposition &&
        !req.target?._attachments?.hasInlineAttachments
      )
        return
      const AttachmentsSrv = await cds.connect.to("attachments")
      return AttachmentsSrv.deleteAttachmentsWithKeys.bind(AttachmentsSrv)(
        res,
        req,
      )
    },
  )

  this.prepend(() =>
    this.on(["PUT", "UPDATE"], async function putUpdateAttachments(req, next) {
      // Skip entities which are not Attachments and skip if content is not updated
      if (!req.target?._attachments?.isAttachmentsEntity || !req.data.content)
        return next()

      let metadata = await this.run(
        SELECT.from(req.subject).columns(
          "url",
          ...Object.keys(req.target.keys),
          "filename",
          "mimeType",
        ),
      )
      if (metadata.length > 1) {
        return req.error(501, "MultiUpdateNotSupported")
      }
      metadata = metadata[0]
      if (!metadata) {
        return req.reject(404)
      }
      req.data.ID = metadata.ID
      req.data.url ??= metadata.url
      // Use mimeType from DB (derived from filename extension), NOT from Content-Type header
      // This prevents attackers from bypassing @Core.AcceptableMediaTypes validation
      req.data.mimeType = metadata.mimeType
      for (const key in metadata) {
        if (key.startsWith("up_")) {
          req.data[key] = metadata[key]
        }
      }
      // Validate mimeType against @Core.AcceptableMediaTypes before uploading content
      if (!validateAttachmentMimeType(req)) return
      const AttachmentsSrv = await cds.connect.to("attachments")
      try {
        return await AttachmentsSrv.put(req.target, req.data)
      } catch (err) {
        if (err.status == 409) {
          return req.error({
            status: 409,
            message: "AttachmentAlreadyExistsCannotBeOverwritten",
            args: [metadata.filename],
          })
        }
        throw err
      }
    }),
  )

  /**
   * Uploads inline attachment content to the object store and triggers an async malware scan.
   * Clears the hash field so the scan's WHERE condition always matches on completion,
   * regardless of any previously stored hash from an earlier upload.
   * @param {import('@sap/cds').Request} req - The current request; req.data is mutated to remove content and clear hash
   * @param {string} prefix - The inline attachment field prefix (e.g. "myAttachment")
   */
  async function putInlineAttachmentObjectStore(req, prefix) {
    const attachmentData = {
      content: req.data[`${prefix}_content`],
      url: req.data[`${prefix}_url`],
      filename: req.data[`${prefix}_filename`],
      _contentElement: req.target.elements[`${prefix}_content`],
    }
    const AttachmentsSrv = await cds.connect.to("attachments")
    await AttachmentsSrv.put(req.target, attachmentData)
    delete req.data[`${prefix}_content`]
    if (cds.env.requires?.attachments?.scan ?? true) {
      const dbKeys = Object.fromEntries(
        Object.entries(req.params?.at(-1) || {}).filter(
          ([k]) => k !== "IsActiveEntity",
        ),
      )
      const malwareScanner = await cds.connect.to("malwareScanner")
      await malwareScanner.emit("ScanAttachmentsFile", {
        target: req.target.name,
        keys: dbKeys,
        prefix,
        url: req.data[`${prefix}_url`], // pass URL directly to avoid DB lookup
      })
    }
  }

  /**
   * Handles a PUT for an inline attachment when the attachment kind is a database.
   * Calls next() to persist the request, then synchronously scans the uploaded content
   * via the malware scanner service (no outbox — db-kind scanner runs in-process).
   * Updates the draft entity with the resulting status, lastScan timestamp, and hash.
   * @param {import('@sap/cds').Request} req - The incoming CDS request; req.data must contain `${prefix}_content`
   * @param {string} prefix - The inline attachment field prefix (e.g. "myAttachment")
   * @param {Function} next - The next handler in the chain
   * @returns {Promise<*>} The result of next()
   */
  async function putInlineAttachmentDb(req, prefix, next) {
    const content = req.data[`${prefix}_content`]
    const result = await next()
    if (content) {
      const dbKeys = Object.fromEntries(
        Object.entries(req.params?.at(-1) || {}).filter(
          ([k]) => k !== "IsActiveEntity",
        ),
      )
      const draftTarget = req.target.drafts || req.target
      try {
        await UPDATE(draftTarget, dbKeys).set({
          [`${prefix}_status`]: "Scanning",
        })
        const malwareScanner = await cds.connect.to("malwareScanner")
        const scanResult = await malwareScanner.send("scan", { file: content })
        const newStatus = scanResult?.isMalware ? "Infected" : "Clean"
        await UPDATE(draftTarget, dbKeys).set({
          [`${prefix}_status`]: newStatus,
          [`${prefix}_lastScan`]: new Date().toISOString(),
          [`${prefix}_hash`]: scanResult?.hash ?? null,
        })
      } catch (e) {
        LOG.error("Failed to scan inline attachment", e)
      }
    }
    return result
  }

  this.prepend(() =>
    this.on(
      ["PUT", "UPDATE"],
      async function putUpdateInlineAttachments(req, next) {
        let prefix

        if (
          req.subject?.ref?.length > 1 &&
          typeof req.subject.ref[1] === "string"
        ) {
          const parentEntityName = req.subject.ref[0].id
          const streamPropertyName = req.subject.ref[1]

          const parentEntityDefinition =
            this.model.definitions[parentEntityName]
          if (!parentEntityDefinition?._attachments?.hasInlineAttachments)
            return next()

          prefix =
            parentEntityDefinition._attachments.inlineAttachmentPrefixes.find(
              (p) => `${p}_content` === streamPropertyName,
            )
        } else {
          if (!req.target._attachments?.hasInlineAttachments) return next()
          prefix = req.target._attachments.inlineAttachmentPrefixes.find(
            (p) => req.data[`${p}_content`],
          )
        }

        if (!prefix) return next()

        if (!validateAttachmentMimeType(req)) return
        if (!(await validateAttachmentSize(req))) return

        await onPrepareAttachment(req)

        if (getAttachmentKind() !== "db") {
          await putInlineAttachmentObjectStore(req, prefix)
        } else {
          return putInlineAttachmentDb(req, prefix, next)
        }

        return next()
      },
    ),
  )

  this.prepend(() =>
    this.on(["CREATE"], async function createAttachments(req, next) {
      if (
        !req.target?._attachments?.isAttachmentsEntity ||
        req.req?.url?.endsWith("/content") ||
        !req.data.url ||
        !(req.data.content || (Array.isArray(req.data) && req.data[0]?.content))
      )
        return next()
      const AttachmentsSrv = await cds.connect.to("attachments")
      req.data.ID ??= cds.utils.uuid()
      await AttachmentsSrv.put(req.target, req.data)
      // READ after write
      return await this.run(
        SELECT.one.from(req.target).where({ ID: req.data.ID }),
      )
    }),
  )

  /**
   * Applies message keys for i18n based on target and field name
   * @param {string} message - base message key
   * @param {string} targetName - target entity name
   * @param {string} fieldName - field name
   * @returns
   */
  function applyMessageKey(message, targetName, fieldName) {
    if (cds.i18n.messages.for(`${message}|${targetName}|${fieldName}`)) {
      return `${message}|${targetName}|${fieldName}`
    }
    if (cds.i18n.messages.for(`${message}|${targetName}`)) {
      return `${message}|${targetName}`
    }
    return message
  }

  /**
   * Retrieves columns to check compositions with min/max items
   * @param {import('@sap/cds').Entity} target - target entity
   * @returns {Array} columns to retrieve
   */
  function retrieveToCheckCompositions(target, depth = 0) {
    const cols = []
    for (const compName in target.compositions) {
      const comp = target.compositions[compName]
      if (comp._target.compositions && depth < 10) {
        const compColumns = retrieveToCheckCompositions(comp._target, depth + 1)
        if (compColumns.length) {
          compColumns.push(
            ...Object.keys(comp._target.keys).map((k) => ({ ref: [k] })),
          )
          cols.push({ ref: [compName], expand: compColumns })
        }
      }
      if (!comp["@Validation.MaxItems"] && !comp["@Validation.MinItems"])
        continue

      const existingExpand = cols.indexOf((c) => c.ref && c.ref[0] === compName)
      if (existingExpand >= 0) {
        cols[existingExpand].count = true
      } else {
        cols.push({ ref: [compName], count: true, expand: [{ ref: ["ID"] }] })
      }
      cols.push(
        // -1 as fallback to indicate that the target is not set
        {
          xpr: stringifyValues(
            comp["@Validation.MinItems"]?.xpr ?? [
              { val: comp["@Validation.MinItems"] ?? -1 },
            ],
          ),
          as: `min${compName}Target`,
        },
        {
          xpr: stringifyValues(
            comp["@Validation.MaxItems"]?.xpr ?? [
              { val: comp["@Validation.MaxItems"] ?? -1 },
            ],
          ),
          as: `max${compName}Target`,
        },
      )
    }
    return cols
  }

  // REVISIT: once cap-js/hana stringifies the values because HDB requires it
  /**
   * Stringifies number values in expressions
   * @param {*} xpr - expression array
   * @returns {*} expression with stringified values
   */
  function stringifyValues(xpr) {
    const elements = structuredClone(xpr)
    for (const ele of elements) {
      if (ele.val !== undefined && typeof ele.val === "number") {
        ele.val = `${ele.val}`
      }
      if (ele.xpr) {
        ele.xpr = stringifyValues(ele.xpr)
      }
    }
    return elements
  }

  /**
   * Builds a CQL WHERE expression array from an entity's key fields and a data object.
   * Skips keys with no value in data, and always sets IsActiveEntity to false (draft context).
   * @param {import('@sap/cds').entity} target - Entity definition whose keys are used
   * @param {object} data - Data object providing key values
   * @returns {Array} CQL expression array suitable for use in .where()
   */
  function buildKeyWhere(target, data) {
    return Object.keys(target.keys).reduce((acc, key) => {
      if (!data[key] && key !== "IsActiveEntity") {
        return acc
      }
      if (acc.length) {
        acc.push("and")
      }
      acc.push({ ref: [key] }, "=", {
        val: key === "IsActiveEntity" ? false : data[key],
      })
      return acc
    }, [])
  }

  /**
   * Recursively checks compositions for min/max items
   * @param {import('@sap/cds').Entity} target - target entity
   * @param {*} data - data to check
   * @param {import('@sap/cds').Request} req - request
   * @param {string} path - path for URL generation
   */
  function checkCompositionAmounts(target, data, req, path = []) {
    for (const compName in target.compositions) {
      const comp = target.compositions[compName]
      if (comp._target.compositions) {
        if (Array.isArray(data[compName])) {
          data[compName].forEach((row) =>
            checkCompositionAmounts(comp._target, row, req, [
              ...path,
              { id: compName, where: buildKeyWhere(comp._target, row) },
            ]),
          )
        } else if (
          data[compName] !== null &&
          data[compName] !== undefined &&
          typeof data[compName] === "object"
        ) {
          checkCompositionAmounts(comp._target, data[compName], req, [
            ...path,
            compName,
          ])
        }
      }
      if (!comp["@Validation.MaxItems"] && !comp["@Validation.MinItems"])
        continue

      const amt =
        data[`${compName}@odata.count`] ??
        data[compName]?.length ??
        (req.event === "CREATE" ? `0` : undefined)
      const minTarget =
        data[`min${compName}Target`] ?? comp["@Validation.MinItems"]
      const maxTarget =
        data[`max${compName}Target`] ?? comp["@Validation.MaxItems"]
      const { path: url } = cds.odata.urlify(
        SELECT.from({ ref: path.concat(compName) }),
        { model: cds.context.model ?? cds.model },
      )
      // Remove first part of URL because CAP adds that themselves
      const targetPath = url.substring(url.indexOf("/") + 1, url.length)
      // Amount can be undefined in UPDATE scenarios where no deep update has happened
      if (
        amt !== undefined &&
        minTarget >= 0 &&
        Number(amt) < Number(minTarget)
      ) {
        const message = {
          status: 400,
          message: applyMessageKey(
            "MinimumAmountNotFulfilled",
            target.name,
            compName,
          ),
          args: [minTarget],
          target: targetPath,
        }
        if (target.isDraft) {
          req.warn(message)
        } else {
          req.error(message)
        }
      }
      if (
        amt !== undefined &&
        maxTarget >= 0 &&
        Number(amt) > Number(maxTarget)
      ) {
        const message = {
          status: 400,
          message: applyMessageKey(
            "MaximumAmountExceeded",
            target.name,
            compName,
          ),
          args: [maxTarget],
          target: targetPath,
        }
        if (target.isDraft) {
          req.warn(message)
        } else {
          req.error(message)
        }
      }
    }
  }

  this.before(["CREATE", "UPDATE"], async (req) => {
    //Case when create is done for child entity
    if (req.query?.INSERT?.into.ref.length > 1) {
      const ref = req.query.INSERT.into.ref.slice(0, -1)
      const parentQuery = { SELECT: { from: { ref: ref }, one: true } }
      const parent = cds.infer.target(parentQuery)
      if (!parent) {
        LOG.warn(
          `Could not determine parent target. Ref: ${JSON.stringify(ref)}`,
        )
        return
      }
      const compName =
        req.query.INSERT.into.ref.at(-1).id ?? req.query.INSERT.into.ref.at(-1)
      const comp = parent.elements[compName]

      if (comp["@Validation.MaxItems"]) {
        let amount = 0,
          targetAmount = 0
        if (typeof comp["@Validation.MaxItems"] === "number") {
          parentQuery.SELECT.from.ref.push(compName)
          parentQuery.SELECT.columns = [
            { func: "count", args: [{ val: "1" }], as: "amt" },
          ]
          const { amt } = await cds.run(parentQuery)
          amount = amt
          targetAmount = comp["@Validation.MaxItems"]
        } else if (comp["@Validation.MaxItems"]?.xpr) {
          parentQuery.SELECT.columns = [
            { func: "count", args: [{ ref: [compName] }], as: "amt" },
            {
              xpr: stringifyValues(comp["@Validation.MaxItems"].xpr),
              as: "target",
            },
          ]
          const { amt, target } = await cds.run(parentQuery)
          amount = amt
          targetAmount = target
        }
        if (Number(amount) >= Number(targetAmount)) {
          const message = {
            status: 400,
            message: applyMessageKey(
              "MaximumAmountExceeded",
              req.target.name,
              compName,
            ),
            args: [targetAmount],
            target: req.target.isDraft ? compName : undefined,
          }
          if (req.target.isDraft) {
            req.warn(message)
          } else {
            req.error(message)
          }
        }
      }
    }
    if (req.target?.compositions && req._?.event === "draftActivate") {
      const query = SELECT.one
        .from(req.target.drafts)
        .where(req.params.at(-1))
        .columns([...Object.keys(req.target.keys).map((k) => ({ ref: [k] }))])
      const cols = retrieveToCheckCompositions(req.target)
      if (cols.length) {
        query.SELECT.columns.push(...cols)
      } else {
        return
      }
      const res = await query
      checkCompositionAmounts(req.target, res, req, [
        { id: req.target.name, where: buildKeyWhere(req.target, res) },
      ])
    } else if (req.target?.compositions) {
      // Version for non draft check of deep compositions
      // REVISIT: Current limitation that only static values are allowed
      checkCompositionAmounts(req.target, req.data, req, [
        { id: req.target.name, where: buildKeyWhere(req.target, req.data) },
      ])
    }
  })

  this.before(["DELETE", "CANCEL"], async (req) => {
    if (req.query?.DELETE?.from?.ref.length > 1) {
      const ref = req.query.DELETE.from.ref.slice(0, -1)
      const parentQuery = { SELECT: { from: { ref: ref }, one: true } }
      const parent = cds.infer.target(parentQuery)
      if (!parent) {
        LOG.warn(
          `Could not determine parent target. Ref: ${JSON.stringify(ref)}`,
        )
        return
      }
      const compName =
        req.query.DELETE.from.ref.at(-1).id ?? req.query.DELETE.from.ref.at(-1)
      const comp = parent.elements[compName]

      if (!comp["@Validation.MinItems"]) return

      let amount = 0,
        targetAmount = 0
      if (typeof comp["@Validation.MinItems"] === "number") {
        parentQuery.SELECT.from.ref.push(compName)
        parentQuery.SELECT.columns = [
          { func: "count", args: [{ val: "1" }], as: "amt" },
        ]
        const { amt } = await cds.run(parentQuery)
        amount = amt
        targetAmount = comp["@Validation.MinItems"]
      } else if (comp["@Validation.MinItems"].xpr) {
        parentQuery.SELECT.columns = [
          { func: "count", args: [{ ref: [compName] }], as: "amt" },
          {
            xpr: stringifyValues(comp["@Validation.MinItems"].xpr),
            as: "target",
          },
        ]
        const { amt, target } = await cds.run(parentQuery)
        amount = amt
        targetAmount = target
      }
      if (Number(amount) <= Number(targetAmount)) {
        const message = {
          status: 400,
          message: applyMessageKey(
            "MinimumAmountNotFulfilled",
            req.target.name,
            compName,
          ),
          args: [targetAmount],
          target: req.target.isDraft ? compName : undefined,
        }
        if (req.target.isDraft) {
          req.warn(message)
        } else {
          req.error(message)
        }
      }
    }
  })

  const AttachmentsSrv = await cds.connect.to("attachments")
  AttachmentsSrv.registerHandlers(this)
})
