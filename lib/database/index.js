const AttachmentsService = require('../common')

class DBAttachmentsService extends AttachmentsService {

    async init() {
        super.init()
        this.db = await cds.connect.to('db')
    }

    async onPUT(source, target, items) {
        const data = []
        const hasData = (await SELECT.from(target)).length > 0 ? true : false;
        // TODO: How to determine property names 'logs' and 'screenshot'
        if (!hasData) {
            items.forEach(item => {
                data.push({
                    entityKey: item.ID,
                    attachments: [{
                        fileName: item.logs_fileName || item.screenshot_fileName
                    }]
                })
            })
            await INSERT.into(target).entries(data)
        }
    }

    async onGET(entity) {
        return (await SELECT.from(entity)).filter(item => item.logs_fileName)
    }

    async onSTREAM() {}

}

module.exports = DBAttachmentsService