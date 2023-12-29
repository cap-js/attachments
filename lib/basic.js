const cds = require('@sap/cds')
const DEBUG = cds.debug('attachments')

class AttachmentsService extends cds.Service {

  init() {
    this.Attachments = this.entities('sap.common').Attachments
  }

  async list (ID) {
    if (ID) {
      const { content } = await SELECT `content` .from ('sap.common.Attachments', ID)
      return content
    }
    const data = await SELECT `content` .from ('sap.common.Attachments')
    return data.map(d => d.content)
  }

  async upload (data) {
    const data_2_upload = []
    for (const data_item of data) {
      const { ID } = data_item
      const content_old = await this.list(ID)
      if (content_old === null) {
        data_2_upload.push(data_item)
      }
    }
    if (data.filename || data_2_upload.length > 0) {
      DEBUG?.('Uploading attachment for', data.filename || data_2_upload.map?.(d => d.filename))
    } else {
      DEBUG?.('No new attachments to upload')
    }
    return await UPSERT (data_2_upload) .into (this.Attachments)
  }

  async download (ID) {
    // NOTE: This will become SELECT.from (in future @sap/cds version)
    const stream = await STREAM.from (this.Attachments,{ID}) .column ('content')
    return stream
  }

}

module.exports = AttachmentsService
