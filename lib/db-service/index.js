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

    async onPUT(entity, items) {
        await INSERT.into(entity).entries(items)
    }

    async onSTREAM(entity, ID) {
      // TODO: This will become SELECT.from
      const stream = await STREAM.from(entity, { ID }).column('content')
      return stream
    }

}

module.exports = DBAttachmentsService
