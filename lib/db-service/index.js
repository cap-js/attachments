const { Readable } = require('stream')

const AttachmentsService = require('../common')


class DBAttachmentsService extends AttachmentsService {

    async onGET(entity, whereCondition) {
        if (whereCondition) {
            return await SELECT.from(entity).where(whereCondition)
        }
        return await SELECT.from(entity)
    }

    async onPUT(entity, items, ID) {
        if (ID) {
            await UPSERT.into(entity).entries(items)
            return
        }
        await INSERT.into(entity).entries(items)
    }

    async onSTREAM(entity, ID) {
      // NOTE: This will become SELECT.from
      const stream = await STREAM.from(entity, { ID }).column('content')
      return stream
    }

}

module.exports = DBAttachmentsService
