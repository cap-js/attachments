module.exports = class RemoteAttachmentsService extends require("./basic") {

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
