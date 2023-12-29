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

  async get_new_uploads(data) {
    if (data.filename) { data = [data] }
    const data_2_upload = []
    for (const i in data) {
      const { ID } = data[i]
      const content_old = await this.list(ID)
      if (!content_old) {
        data_2_upload.push(data[i])
      }
    }
    if (data.filename || data_2_upload.length > 0) {
      DEBUG?.('Uploading attachment for', data_2_upload.map?.(d => d.filename))
    } else {
      DEBUG?.('No new attachments to upload')
    }
    return data_2_upload
  }

  async upload (data) {
    return await UPSERT (data) .into (this.Attachments)
  }

  async download (ID) {
    // NOTE: This will become SELECT.from (in future @sap/cds version)
    const stream = await STREAM.from (this.Attachments,{ID}) .column ('content')
    return stream
  }

}

module.exports = AttachmentsService
