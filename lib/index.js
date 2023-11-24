const { Readable } = require('stream')
const { connectToAttachmentsService, getElementsOfType } = require('./helpers')


const ReadImagesHandler = async (req, next) => {
    const srvName = req.tx.name
    const imageIsRequested = req?._path ? req._path.endsWith('$value') : false

    const media_srv = await connectToAttachmentsService()
    const imageElements = getElementsOfType(req, 'Image')

    // Add image streaming
    if (imageIsRequested) {
      const stream = await media_srv.onSTREAM(req.entity, req.params[0])
      return {
        value: stream
      }
    }

    // Add image urls
    const data = await next()
    if (data) {
        for (const element of imageElements) {
            const [k, v] = element
            if (data?.[k]) {
                const ID = data[k].ID
                if (!data[k]?.[v]) data[k] = Object.assign(data[k], { [v]: { }, });
                const baseUrl = req?.req?.baseUrl || 'http://localhost:4004'
                const baseEntity = cds.model.definitions[req.entity].elements[k].target.split('.')[1]
                const url = `${baseUrl}/${baseEntity}(${ID})/${v}/$value`
                data[k][v].url = url
                data[k][v]['url@odata.mediaReadLink'] = url
            }
        }
        return data
    }

    return next()

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