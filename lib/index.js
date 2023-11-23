const { Readable } = require('stream')
const { connectToAttachmentsService, getElementsOfType } = require('./helpers')

const ReadImagesHandler = async (req, next) => {
    const data = await next();

    const imageElements = getElementsOfType(req, 'Image')
    const media_srv = await connectToAttachmentsService()

    //TODO: Reimplement S3 streaming/ url handling
    //  // Add image streaming
    // if (req?._path && req?._path.endsWith('/content')) {
    //     const ID = req.params[0].ID
    //     const stream = await media_srv.onSTREAM(ID);
    //     return {
    //            value: stream,
    //            //$mediaContentType: 'image/png'
    //     }
    // }

    // if (data) {
    //     // Add app urls
    //     for (const element of imageElements) {
    //         const [k, v] = element
    //         if (data?.[k]) {
    //             const ID = data[k].ID
    //             if (!data[k]?.[v]) data[k] = Object.assign(data[k], { [v]: { }, });
    //             const url = `http://localhost:4004/odata/v4/processor/Customers(ID=${ID})/${v}/content`
    //             data[k][v].url = url
    //             data[k][v]['url@odata.mediaReadLink'] = url
    //         }
    //     }
    //     return data
    // }

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