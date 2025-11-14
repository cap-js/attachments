module.exports = class RemoteAttachmentsService extends require("./basic") {

  updateContentHandler(req, next) {
    return next()
  }

  /**
   * @inheritdoc
   */
  registerHandlers(srv) {
    srv.prepend(() => {
        srv.on(
          "PUT",
          (req, next) => {
            if (!req.target._attachments.isAttachmentsEntity) return next()
            return this.updateContentHandler.bind(this)(req, next)
          }
        )
      })

    srv.prepend(() => {
        srv.on(
          ["CREATE", 'UPDATE'],
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
