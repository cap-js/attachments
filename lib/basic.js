const cds = require('@sap/cds')
const DEBUG = cds.debug('attachments')

module.exports = class AttachmentsService extends cds.Service {
  async put(Attachments, data, _content) {
    if (!Array.isArray(data)) {
      if (_content) data.content = _content;
      data = [data];
    }
    DEBUG?.(
      "Uploading attachments for",
      Attachments.name,
      data.map?.((d) => d.filename)
    );
    return Promise.all(
      data.map((d) => {
        return UPSERT(d).into(Attachments);
      })
    );
  }

  async get(Attachments, keys) {
    if (Attachments.isDraft) {
      Attachments = Attachments.actives;
    }
    DEBUG?.("Downloading attachment for", Attachments.name, keys);
    const result = await SELECT.from(Attachments, keys).columns("content");
    return (result && result.content)? result.content : null;
  }

  async registerUpdateHandlers(srv,entity){
    //update handlers are not required for the db variant as of now.
    return;
  }

  async delete(Attachments, data) {
    DEBUG?.("Deleting attachment for", Attachments.name, data.filename)
    return DELETE.from(Attachments).where({up__ID: data.up__ID, filename: data.filename})
  }

  async update(Attachments, key, data) {
    DEBUG?.("Updating attachment for", Attachments.name, key)
    return UPDATE(Attachments, key).with(data)
  }
};
