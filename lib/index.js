const { Readable } = require('stream')
const { connectToAttachmentsService, getElementsOfType } = require('./helpers')

const ReadImagesHandler = async (req, next) => {
    const data = await next();

    if (data && data?.content) {
        const readable = Readable.from(new Buffer.from(data.content, 'base64'))
        return {
            value: readable,
            $mediaContentType: 'image/png',
        }
    }
    return data

}

const ReadAttachmentsHandler = async (req, next) => {
    let data = await next()

    // Get associations to types 'Attachments' and 'Image'
    //const AttachmentsFromAssocs = getElementsOfType(req, 'Attachments')

    if (data.length === 0) {
        const media_srv = await connectToAttachmentsService()
        // Add data for attachments
        const srv = req.tx.name
        const ID = req.params[0].ID
        let res = await media_srv.onGET(`sap.attachments.AttachmentsView`, { entityKey: ID })
        for (const r of res) {
            const { fileName, createdAt, createdBy, ...rest } = r
            data.push({ createdAt, createdBy, fileName })
        }
        const count = data.length
        data.$count = count
        return data
    }
}

module.exports = { ReadImagesHandler, ReadAttachmentsHandler }