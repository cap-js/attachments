const cds = require("@sap/cds")
const {
  validateAttachment,
  readAttachment,
  validateAttachmentSize,
  onPrepareAttachment,
  validateAttachmentMimeType,
  validateAndInsertAttachmentFromDBHandler,
} = require("./generic-handlers")
const { inferTargetCAP8, getAttachmentKind } = require("./helper")
require("./csn-runtime-extension")
const LOG = cds.log("attachments")

cds.on(cds.version >= "8.6.0" ? "compile.to.edmx" : "loaded", unfoldModel)

// Register the db handler ONCE (not per-service) to intercept attachment INSERT
// and handle it through the attachments service instead of native DB insert
// NOTE: Must be synchronous - avoid await inside 'served' handler as emit is synchronous
// NOTE: Database services use INSERT/UPDATE/DELETE/SELECT events, not CREATE/READ etc.
// NOTE: Must use db.prepend() to ensure handlers run before existing ones
cds.once("served", () => {
  if (!cds.env.requires.attachments) return
  const { db } = cds.services

  db.prepend(() => {
    db.on("INSERT", async function handleDBInsert(req, next) {
      // Only intercept attachment entities with content, when not using db storage
      if (
        !req.data ||
        !req?.target?._attachments?.isAttachmentsEntity ||
        getAttachmentKind() === "db"
      ) {
        return next()
      }

      const entries = req.data instanceof Array ? req.data : [req.data]

      // Check if any entry has content - if not, let native INSERT handle it
      const hasContent = entries.some((entry) => entry.content)
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
      return entries.length === 1 ? entries[0] : entries
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
  const hasFacetForComp = (comp, facets) =>
    facets.some(
      (f) =>
        f.Target === `${comp.name}/@UI.LineItem` ||
        (f.Facets && hasFacetForComp(comp, f.Facets)),
    )
  cds.linked(csn).forall("Composition", (comp) => {
    if (
      comp._target &&
      comp._target["@_is_media_data"] &&
      comp.parent &&
      comp.is2many
    ) {
      let facets = comp.parent["@UI.Facets"]
      if (!facets) return
      if (comp["@attachments.disable_facet"] !== undefined) {
        LOG.warn(
          `@attachments.disable_facet is deprecated! Please annotate ${comp.name} with @UI.Hidden`,
        )
      }
      if (
        !comp["@attachments.disable_facet"] &&
        !hasFacetForComp(comp, facets)
      ) {
        LOG.debug(`Adding @UI.Facet to: ${comp.parent.name}`)
        const attachmentsFacet = {
          $Type: "UI.ReferenceFacet",
          Target: `${comp.name}/@UI.LineItem`,
          ID: `${comp.name}_attachments`,
          Label: "{i18n>Attachments}",
        }
        if (comp["@UI.Hidden"]) {
          attachmentsFacet["@UI.Hidden"] = comp["@UI.Hidden"]
        }
        facets.push(attachmentsFacet)
        //Hide parent key so it cannot be selected from Columns on the UI
        Object.keys(comp._target.elements)
          .filter((e) => e.startsWith("up__"))
          .forEach((ele) => {
            comp._target.elements[ele]["@UI.Hidden"] = true
          })
        if (comp._target.elements["up_"]) {
          comp._target.elements["up_"]["@UI.Hidden"] = true
        }
      }
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
  this.before("NEW", onPrepareAttachment)
  this.before("CREATE", (req) => {
    return onPrepareAttachment(req)
  })

  this.before(["PUT", "UPDATE"], (req) => {
    if (req.target._attachments.isAttachmentsEntity && "url" in req.data) {
      delete req.data.url
    }
  })

  this.before(
    ["DELETE", "UPDATE"],
    async function collectDeletedAttachmentsForDraftEnabled(req) {
      if (!req.target?._attachments.hasAttachmentsComposition) return
      const AttachmentsSrv = await cds.connect.to("attachments")
      return AttachmentsSrv.attachDeletionData.bind(AttachmentsSrv)(req)
    },
  )
  this.after(
    ["DELETE", "UPDATE"],
    async function deleteCollectedDeletedAttachmentsForDraftEnabled(res, req) {
      if (!req.target?._attachments.hasAttachmentsComposition) return
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
      if (!req.target._attachments.isAttachmentsEntity || !req.data.content)
        return next()

      let metadata = await this.run(
        SELECT.from(req.subject).columns(
          "url",
          ...Object.keys(req.target.keys),
          "filename",
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
      for (const key in metadata) {
        if (key.startsWith("up_")) {
          req.data[key] = metadata[key]
        }
      }
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

  this.prepend(() =>
    this.on(["CREATE"], async function createAttachments(req, next) {
      if (
        !req.target._attachments.isAttachmentsEntity ||
        req.req?.url?.endsWith("/content") ||
        !req.data.url ||
        !(req.data.content || (Array.isArray(req.data) && req.data[0]?.content))
      )
        return next()
      const AttachmentsSrv = await cds.connect.to("attachments")
      return AttachmentsSrv.put(req.target, req.data)
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
  function retrieveToCheckCompositions(target) {
    const cols = []
    for (const compName in target.compositions) {
      const comp = target.compositions[compName]
      if (comp._target.compositions) {
        const compColumns = retrieveToCheckCompositions(comp._target)
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
    if (req.query.INSERT?.into.ref.length > 1) {
      const ref = req.query.INSERT.into.ref.slice(0, -1)
      const parentQuery = { SELECT: { from: { ref: ref }, one: true } }
      const parent =
        cds.infer?.target?.(parentQuery) || inferTargetCAP8(req, ref)
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
    if (req.target.compositions && req._?.event === "draftActivate") {
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
    } else if (req.target.compositions) {
      // Version for non draft check of deep compositions
      // REVISIT: Current limitation that only static values are allowed
      checkCompositionAmounts(req.target, req.data, req, [
        { id: req.target.name, where: buildKeyWhere(req.target, req.data) },
      ])
    }
  })

  this.before(["DELETE", "CANCEL"], async (req) => {
    if (req.query.DELETE.from.ref.length > 1) {
      const ref = req.query.DELETE.from.ref.slice(0, -1)
      const parentQuery = { SELECT: { from: { ref: ref }, one: true } }
      const parent =
        cds.infer?.target?.(parentQuery) || inferTargetCAP8(req, ref)
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
