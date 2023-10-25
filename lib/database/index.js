const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')

const AttachmentsService = require('../common')

class DBAttachmentsService extends AttachmentsService {

    async init() {
        super.init()
        this.db = await cds.connect.to('db')
    }

    async onSTREAM(name) {
        const ID = name.replace('sap.capire.incidents.Customers-', '').replace('.png', '')
        return await STREAM.from('ProcessorService.Customers', { ID }).column('avatar_content')
    }

}

module.exports = DBAttachmentsService