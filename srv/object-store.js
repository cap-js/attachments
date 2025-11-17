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

  /**
   * @inheritdoc
   */
  registerHandlers(srv) {
    srv.prepend(() => {
        srv.on(
          ["PUT", "UPDATE"],
          async (req, next) => {
            // Skip entities which are not Attachments and skip if content is not updated
            if (!req.target._attachments.isAttachmentsEntity || !req.data.content) return next()

            let metadata = await srv.run(SELECT.from(req.subject).columns('url', ...Object.keys(req.target.keys)))
            if (metadata.length > 1) {
              return req.error(501, 'MultiUpdateNotSupported')
            }
            metadata = metadata[0]
            if (!metadata) {
              return req.reject(404)
            }
            req.data.ID = metadata.ID
            req.data.url ??= metadata.url
            for (const key in metadata) {
              if (key.startsWith('up_')) {
                req.data[key] = metadata[key]
              }
            }
            return await this.put.bind(this)(req.target, req.data)
          }
        )
      })

    srv.prepend(() => {
        srv.on(
          ["CREATE"],
          (req, next) => {
            if (!req.target._attachments.isAttachmentsEntity || req.req?.url?.endsWith('/content') || !req.data.url || !(req.data.content || (Array.isArray(req.data) && req.data[0]?.content))) return next()
            return this.put.bind(this)(req.target, req.data)
          }
        )
      })

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
  }
}
