
const cds = require('@sap/cds')

class AttachmentsService extends cds.Service {

	async init() {

        const { credentials } = cds.env.requires['@cap-js/attachments'] || {}
        this.credentials = credentials

        this.db = await cds.connect.to('db')

		return super.init()
	}



}

module.exports = AttachmentsService;