const AttachmentsService = require('../common')

class DBAttachmentsService extends AttachmentsService {

    async init() {
        super.init()
        this.db = await cds.connect.to('db')
    }

    async onGET(origin) {
        const res = await SELECT.from('ProcessorService.Customers').columns(['avatar_fileName', 'avatar_type', 'avatar_url', 'avatar_content'])
        res.forEach(r => {
            const file = r.fileName
            r.avatar_url = `${origin}/media/?file=${file}`
        })
        return res
    }

    async onSTREAM(name) {
        const ID = name.replace('sap.capire.incidents.Customers-', '').replace('.png', '')
        return await STREAM.from('ProcessorService.Customers', { ID }).column('avatar_content')
    }

}

module.exports = DBAttachmentsService