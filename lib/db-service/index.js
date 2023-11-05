const { Readable } = require('stream')

const AttachmentsService = require('../common')


class DBAttachmentsService extends AttachmentsService {

    async init() {
        super.init()

        this.db = await cds.connect.to('db')
    }

    async onPUT(entityName, items) {
        // const data = []
        // items.forEach(item => {
        //     data.push({ ... })
        // })
        // await INSERT.into(entity).entries(data)
    }

    async onGET(ID) {
        if (ID) {
            return (await SELECT.from('sap.attachments.Images').where({ID}))
        }
        return await SELECT.from('sap.attachments.Images')
    }

    async onSTREAM(fileName) {
        // Blobs (large binaries) are skipped from {SELECT *}
        // To get them, we must explicitly select them
        const res = await SELECT.from('sap.attachments.Images').columns('content').where({fileName})
        return  Readable.from(new Buffer.from(res[0].content, 'base64'))
    }

}

module.exports = DBAttachmentsService
