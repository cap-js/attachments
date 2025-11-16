module.exports = class RemoteAttachmentsService extends require("./basic") {

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
              return req.error(501, 'MULTI_UPDATE_NOT_SUPPORTED')
            }
            metadata = metadata[0]
            if (!metadata) {
              return req.error(404)
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
