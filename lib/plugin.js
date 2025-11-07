const cds = require("@sap/cds")
const { validateAttachment, readAttachment, validateAttachmentSize, onPrepareAttachment } = require("./genericHandlers")
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
      }

    }
  })
  meta._enhanced_for_attachments = true
}

cds.once("served", async function registerPluginHandlers() {
  if (!("sap.attachments.Attachments" in cds.model.definitions)) return
  const AttachmentsSrv = await cds.connect.to("attachments")
  // Searching all associations to attachments to add respective handlers
  for (let srv of cds.services) {
    if (srv instanceof cds.ApplicationService) {
      LOG.debug(`Registering handlers for attachments entities for service: ${srv.name}`)
      srv.before("READ", validateAttachment)
      srv.after("READ", readAttachment)
      srv.before("PUT", validateAttachmentSize)
      srv.before("NEW", onPrepareAttachment)
      srv.before("CREATE", (req) => {
        if (req.target.drafts) return; //Skip if entity is draft enabled
        return onPrepareAttachment(req)
      })

      srv.before(["DELETE", "UPDATE"], function collectDeletedAttachmentsForDraftEnabled(req) {
        if (!req.target?._attachments.hasAttachmentsComposition) return;

        return AttachmentsSrv.attachDeletionData.bind(AttachmentsSrv)(req)
      })
      srv.after(["DELETE", "UPDATE"], function deleteCollectedDeletedAttachmentsForDraftEnabled(res, req) {
        if (!req.target?._attachments.hasAttachmentsComposition) return;

        return AttachmentsSrv.deleteAttachmentsWithKeys.bind(AttachmentsSrv)(res, req)
      })

      // case: attachments uploaded in draft and draft is discarded
      srv.before(["CANCEL"], function collectDiscardedAttachmentsForDraftEnabled(req) {
        if (!req.target?.actives || !req.target?._attachments.hasAttachmentsComposition) return;

        return AttachmentsSrv.attachDraftDiscardDeletionData.bind(AttachmentsSrv)(req)
      })
      srv.after(["CANCEL"], function deleteCollectedDiscardedAttachmentsForDraftEnabled(res, req) {
        //Check for actives to make sure it is the draft entity
        if (!req.target?.actives || !req.target?._attachments.hasAttachmentsComposition) return;

        return AttachmentsSrv.deleteAttachmentsWithKeys.bind(AttachmentsSrv)(res, req)
      })

      AttachmentsSrv.registerUpdateHandlers(srv)
      AttachmentsSrv.registerDraftUpdateHandlers(srv)
    }
  }
})