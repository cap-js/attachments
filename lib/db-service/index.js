const { Readable } = require('stream')

const AttachmentsService = require('../common')


class DBAttachmentsService extends AttachmentsService {

    async init() {
        super.init()

        this.db = await cds.connect.to('db')
    }

    async onGET(entity, whereCondition) {
        if (whereCondition) {
            return await SELECT.from(entity).where(whereCondition)
        }
            return await SELECT.from(entity)
    }

    async onPUT(event, entity, items) {
        try {
            switch (event) {
                case 'INSERT':
                    await INSERT.into(entity).entries(items)
                    break
                case 'UPSERT':
                    await UPSERT.into(entity).entries(items)
                    break
            }
        } catch (err) {

        }
    }

    async onSTREAM(entity, ID) {
        // Blobs (large binaries) are skipped from {SELECT *}
        // To get them, we must explicitly select them
        const res = await SELECT.from(entity).columns('content').where({ID})
        return  Readable.from(new Buffer.from(res[0].content, 'base64'))
    }

}

module.exports = DBAttachmentsService
