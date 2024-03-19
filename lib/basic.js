const cds = require('@sap/cds');
const DEBUG = cds.debug('attachments');

module.exports = class AttachmentsService extends cds.Service {

  async put(attachments, data, _content) {
    if (!Array.isArray(data)) {
      if (_content) data.content = _content;
      data = [data];
    }
    DEBUG?.(
      "Uploading attachments for",
      attachments.name,
      data.map?.((d) => d.filename)
    );
    return Promise.all(
      data.map((d) => {
        return UPSERT(d).into(attachments);
      })
    );
  }

  async get(attachments, keys) {
    if (attachments.isDraft) {
      attachments = attachments.actives;
    }
    DEBUG?.("Downloading attachment for", attachments.name, keys);
    const result = await SELECT.from(attachments, keys).columns("content");
    return (result && result.content)? result.content : null;
  }

  /**
   * Returns a handler to copy updated attachments content from draft to active / object store
   */
  draftSaveHandler4(Attachments) {
    const queryFields = this.getFields(Attachments);
    return async (_, req) => {
      // The below query loads the attachments into streams
      const draftAttachments = await SELECT(queryFields)
        .from(Attachments.drafts)
        .where([
          ...req.subject.ref[0].where.map((x) =>
            x.ref ? { ref: ["up_", ...x.ref] } : x
          ),
          "and",
          { ref: ["content"] },
          "is not null", // NOTE: needs skip LargeBinary fix to Lean Draft
        ]);
      if (draftAttachments.length)
        await this.put(Attachments, draftAttachments);
    };
  }

  getFields(attachments) {
    const attachmentFields = ["filename", "mimeType", "content", "url", "ID"];
    const { up_ } = attachments.keys;
    if (up_)
      return up_.keys
        .map((k) => "up__" + k.ref[0])
        .concat(...attachmentFields)
        .map((k) => ({ ref: [k] }));
    else return Object.keys(attachments.keys);
  }

  async registerUpdateHandlers(srv, entity, target){
    srv.after("SAVE", entity, this.draftSaveHandler4(target));
    return;
  }

};
