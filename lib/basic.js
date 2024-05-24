const cds = require('@sap/cds');
const DEBUG = cds.debug('attachments');
const { SELECT, UPSERT, UPDATE } = cds.ql;
const { scanRequest } = require('./malwareScanner')

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

    const res = await Promise.all(
      data.map(async (d) => {
        return await UPSERT(d).into(attachments);
      })
    );

    if(this.kind === 'db') data.map((d) => { scanRequest(attachments, { ID: d.ID })})

    return res;
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
  draftSaveHandler(attachments) {
    const queryFields = this.getFields(attachments);
    return async (_, req) => {
      // The below query loads the attachments into streams
      const draftAttachments = await SELECT(queryFields)
        .from(attachments.drafts)
        .where([
          ...req.subject.ref[0].where.map((x) =>
            x.ref ? { ref: ["up_", ...x.ref] } : x
          ),
          "and",
          { ref: ["content"] },
          "is not null", // NOTE: needs skip LargeBinary fix to Lean Draft
        ]);
      if (draftAttachments.length)
        await this.put(attachments, draftAttachments);
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

  async registerUpdateHandlers(srv, entity, target) {
    srv.after("SAVE", entity, this.draftSaveHandler(target));
    return;
  }

  async update(Attachments, key, data) {
    DEBUG?.("Updating attachment for", Attachments.name, key)
    return await UPDATE(Attachments, key).with(data)
  }
};
