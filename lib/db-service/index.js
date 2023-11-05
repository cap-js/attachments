const { Readable } = require('stream')

const AttachmentsService = require('../common')


class DBAttachmentsService extends AttachmentsService {

    async init() {
        super.init()

        this.db = await cds.connect.to('db')
    }

    async onGET(fileName) {
        if (fileName) {
            return (await SELECT.from('sap.attachments.Images').where({fileName}))
        }
        return await SELECT.from('sap.attachments.Images')
    }

    async onPUT(items) {
        await INSERT.into('sap.attachments.Images').entries(items)
    }

    async onSTREAM(fileName) {
        // Blobs (large binaries) are skipped from {SELECT *}
        // To get them, we must explicitly select them
        const res = await SELECT.from('sap.attachments.Images').columns('content').where({fileName})
        return  Readable.from(new Buffer.from(res[0].content, 'base64'))
    }

}

module.exports = DBAttachmentsService
