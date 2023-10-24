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
        // TODO: Why is there not image content in the result?
        const resFromDb = await SELECT.from('ProcessorService.Customers').where({ID: ID})
        const customerName = resFromDb[0].name
        const res = [{ avatar_content: fs.readFileSync(path.join(cds.env._home, `assets/${customerName}.png`)) }]
        const content = res[0].avatar_content
        return Readable.from(content)
    }

}

module.exports = DBAttachmentsService