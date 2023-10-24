
const cds = require('@sap/cds')

class AttachmentsService extends cds.Service {

	init() {

        const { credentials } = cds.env.requires['@cap-js/attachments'] || {}
        this.credentials = credentials

		this.on('onGET', async() => this.onGET())
		this.on('onSTREAM', async(file) => this.onSTREAM(file))

		return super.init()
	}

	async onSTREAM(req) {
		return await srv.onStream(req.data.fileName)
	}

}

module.exports = AttachmentsService;