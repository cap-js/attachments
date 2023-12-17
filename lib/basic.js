const cds = require('@sap/cds')

class AttachmentsService extends cds.Service {

  init() {
    this.Attachments = this.entities('sap.common').Attachments
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
