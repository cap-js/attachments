const { connectToAttachmentsService, getElementsOfType } = require('./helpers')

const ReadImagesHandler = async (req, next) => {
    const data = await next();

    // TODO: Rewrite this generically
    // Get associations to type 'Image'
    const imageElements = getElementsOfType(req, 'Image')

    const media_srv = await connectToAttachmentsService()
    if (data) {
        // Add app urls for image streaming
        for (const element of imageElements) {
            const [k, v] = element
            if (data?.[k]) {
                const ID = data[k].ID
                const res = await media_srv.onGET('sap.attachments.Images', { ID })
                if (!data[k]?.[v]) data[k] = Object.assign(data[k], { [v]: {} });
                data[k][v].url = `/media/?ID=${ID}`
                data[k][v]['url@odata.mediaReadLink'] = `/media/?ID=${ID}`
            }
        }
        return data
    }
}

const ReadAttachmentsHandler = async (req, next) => {
    let data = await next()

    // Get associations to types 'Attachments' and 'Image'
    const AttachmentsFromAssocs = getElementsOfType(req, 'Attachments')

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