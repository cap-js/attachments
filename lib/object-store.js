const cds = require("@sap/cds")
const LOG = cds.log('attachments')

module.exports = class RemoteAttachmentsService extends require("./basic") {

  clientsCache = new Map()
  isMultiTenancyEnabled = !!cds.env.requires.multitenancy
  objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind
  separateObjectStore = this.isMultiTenancyEnabled && this.objectStoreKind === "separate"

  init() {
    LOG.debug(`${this.constructor.name} initialization`, {
      multiTenancy: this.isMultiTenancyEnabled,
      objectStoreKind: this.objectStoreKind,
      separateObjectStore: this.separateObjectStore,
      attachmentsConfig: {
        kind: cds.env.requires?.attachments?.kind,
        scan: cds.env.requires?.attachments?.scan
      }
    })

    return super.init()
  }
  updateContentHandler(req, next) {
    return next()
  }

  /**
   * @inheritdoc
   */
  registerUpdateHandlers(srv) {
    srv.prepend(() => {
      srv.on(
        "PUT",
        (req, next) => {
          if (!req.target._attachments.isAttachmentsEntity) return next()
          return this.updateContentHandler.bind(this)(req, next)
        }
      )
    })
  }

  /**
   * @inheritdoc
   */
  registerDraftUpdateHandlers(srv) {
    srv.before(
      "DELETE",
      (req) => {
        if (!req.target.isDraft || !req.target._attachments.isAttachmentsEntity) return;
        return this.attachDraftDeletionData.bind(this)(req)
      }
    )
    srv.after(
      "DELETE",
      (res, req) => {
        if (!req.target.isDraft || !req.target._attachments.isAttachmentsEntity) return;
        return this.deleteAttachmentsWithKeys.bind(this)(res, req)
      }
    )
    srv.prepend(() => {
      srv.on(
        "PUT",
        (req, next) => {
          if (!req.target.isDraft || !req.target._attachments.isAttachmentsEntity) return next()
          return this.updateContentHandler.bind(this)(req, next)
        }
      )
    })
  }
}
