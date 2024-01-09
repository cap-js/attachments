const cds = require('@sap/cds')
const DEBUG = cds.debug('attachments')

module.exports = class AttachmentsService extends cds.Service {

  async put (Attachments, data, _content) {
    DEBUG?.('Uploading attachments for', Attachments.name, data.filename || data.map?.(d => d.filename))
    if (_content) data.content = _content
    return await UPSERT (data) .into (Attachments)
  }

  async get (Attachments, keys) {
    DEBUG?.('Downloading attachment for', Attachments.name, keys)
    return await STREAM.from (Attachments,keys) .column ('content') // NOTE: This will become SELECT.from (in future @sap/cds version)
  }

}
