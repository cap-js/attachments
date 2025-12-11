const cds = require("@sap/cds")
const { validateAttachment, readAttachment, validateAttachmentSize, onPrepareAttachment, validateAttachmentMimeType } = require("./generic-handlers")
require("./csn-runtime-extension")
const LOG = cds.log('attachments')

cds.on(cds.version >= "8.6.0" ? "compile.to.edmx" : "loaded", unfoldModel)

function unfoldModel(csn) {
  const meta = csn.meta ??= {}
  if (!("sap.attachments.Attachments" in csn.definitions)) return
  if (meta._enhanced_for_attachments) return
  // const csnCopy = structuredClone(csn) // REVISIT: Why did we add this cloning?
  const hasFacetForComp = (comp, facets) => facets.some(f => f.Target === `${comp.name}/@UI.LineItem` || (f.Facets && hasFacetForComp(comp, f.Facets)))
  cds.linked(csn).forall("Composition", (comp) => {
    if (comp._target && comp._target["@_is_media_data"] && comp.parent && comp.is2many) {
      let facets = comp.parent["@UI.Facets"]
      if (!facets) return
      if (comp["@attachments.disable_facet"] !== undefined) {
        LOG.warn(`@attachments.disable_facet is deprecated! Please annotate ${comp.name} with @UI.Hidden`)
      }
      if (!comp["@attachments.disable_facet"] && !hasFacetForComp(comp, facets)) {
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
        Object.keys(comp._target.elements).filter(e => e.startsWith('up__')).forEach(ele => {
          comp._target.elements[ele]['@UI.Hidden'] = true;
        })
        if (comp._target.elements['up_']) {
          comp._target.elements['up_']['@UI.Hidden'] = true;
        }
      }

    }
  })
  meta._enhanced_for_attachments = true
}

cds.ApplicationService.handle_attachments = cds.service.impl(async function () {
  if (!cds.env.requires.attachments) return;
  LOG.debug(`Registering handlers for attachments entities for service: ${this.name}`)
  this.before("READ", validateAttachment)
  this.after("READ", readAttachment)
  this.before("PUT", validateAttachmentSize)
  this.before("PUT", validateAttachmentMimeType)
  this.before("NEW", onPrepareAttachment)
  this.before("CREATE", (req) => {
    return onPrepareAttachment(req)
  })

  this.before(["DELETE", "UPDATE"], async function collectDeletedAttachmentsForDraftEnabled(req) {
    if (!req.target?._attachments.hasAttachmentsComposition) return;
    const AttachmentsSrv = await cds.connect.to("attachments")
    return AttachmentsSrv.attachDeletionData.bind(AttachmentsSrv)(req)
  })
  this.after(["DELETE", "UPDATE"], async function deleteCollectedDeletedAttachmentsForDraftEnabled(res, req) {
    if (!req.target?._attachments.hasAttachmentsComposition) return;
    const AttachmentsSrv = await cds.connect.to("attachments")
    return AttachmentsSrv.deleteAttachmentsWithKeys.bind(AttachmentsSrv)(res, req)
  })


  this.prepend(() =>
    this.on(
      ["PUT", "UPDATE"],
      async function putUpdateAttachments(req, next) {
        // Skip entities which are not Attachments and skip if content is not updated
        if (!req.target._attachments.isAttachmentsEntity || !req.data.content) return next()

        let metadata = await this.run(SELECT.from(req.subject).columns('url', ...Object.keys(req.target.keys), 'filename'))
        if (metadata.length > 1) {
          return req.error(501, 'MultiUpdateNotSupported')
        }
        metadata = metadata[0]
        if (!metadata) {
          return req.reject(404)
        }
        req.data.ID = metadata.ID
        req.data.url ??= metadata.url
        req.data.filename ??= metadata.filename
        for (const key in metadata) {
          if (key.startsWith('up_')) {
            req.data[key] = metadata[key]
          }
        }
        const AttachmentsSrv = await cds.connect.to("attachments")
        try {
          return await AttachmentsSrv.put(req.target, req.data)
        } catch (err) {
          if (err.status == 409) {
            return req.error({ status: 409, message: "AttachmentAlreadyExistsCannotBeOverwritten", args: [metadata.filename] })
          }
        }
      }
    )
  )

  this.prepend(() =>
    this.on(
      ["CREATE"],
      async function createAttachments(req, next) {
        if (!req.target._attachments.isAttachmentsEntity || req.req?.url?.endsWith('/content') || !req.data.url || !(req.data.content || (Array.isArray(req.data) && req.data[0]?.content))) return next()
        const AttachmentsSrv = await cds.connect.to("attachments")
        return AttachmentsSrv.put(req.target, req.data)
      }
    )
  )

  const AttachmentsSrv = await cds.connect.to("attachments")
  AttachmentsSrv.registerHandlers(this)
})
