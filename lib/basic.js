const cds = require('@sap/cds')
const DEBUG = cds.debug('attachments')

module.exports = class AttachmentsService extends cds.Service {

  async put (Attachments, data, _content) {
    if (!Array.isArray(data)) {
      if (_content) data.content = _content
      data = [data]
    }
    DEBUG?.('Uploading attachments for', Attachments.name, data.map?.(d => d.filename))
    return Promise.all (data.map (d => {
      return UPSERT (d) .into (Attachments)
    }))
  }

  async get (Attachments, keys) {
    DEBUG?.('Downloading attachment for', Attachments.name, keys)
    const result = await SELECT.from (Attachments,keys) .columns ('content')
    return result.content
  }

}
