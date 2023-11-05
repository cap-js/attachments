
const cds = require('@sap/cds')

class AttachmentsService extends cds.Service {

	init() {

        const { credentials } = cds.env.requires['@cap-js/attachments'] || {}
        this.credentials = credentials

		return super.init()
	}

}

module.exports = AttachmentsService;