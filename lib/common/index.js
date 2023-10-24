
const cds = require('@sap/cds')

class AttachmentsService extends cds.Service {

	init() {

        const { credentials } = cds.env.requires['@cap-js/attachments']
        this.credentials = credentials

		this.on('onSTREAM', async(file) => this.onSTREAM(file))
		//this.on('GET', async () => await srv.listObjects())
		//this.on('uploadBulk', async () => await srv.uploadBulk())
		//this.on('emptyBucket', async () => await srv.emptyBucket())
		return super.init()
	}

	async onSTREAM(req) {
		return await srv.onStream(req.data.fileName)
	}

}

module.exports = AttachmentsService;