const { Readable } = require('stream')
const { connectToAttachmentsService, getElementsOfType } = require('./helpers')


const ReadImagesHandler = async (req, next) => {

    const { data, event } = cds.context

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
    let results = await next()
    if (results) {
        if (event === 'CREATE') {
            results = Object.assign(results, data)
            await media_srv.onPUT('sap.attachments.Attachments', results)
        }
        for (const element of imageElements) {
            const [k, v] = element
            if (results?.[k]) {
                const ID = results[k].ID
                if (!results[k]?.[v]) results[k] = Object.assign(results[k], { [v]: { }, });
                const baseUrl = req?.req?.baseUrl || 'http://localhost:4004'
                const baseEntity = cds.model.definitions[req.entity].elements[k].target.split('.')[1]
                const url = `${baseUrl}/${baseEntity}(${ID})/${v}/$value`
                results[k][v].url = url
                results[k][v]['url@oresults.mediaReadLink'] = url
            }
        }
        return results
    }

    return next()

}

const CreateAttachmentsHandler = async (req, next) => {
    let results = await next()

    // Store attachment
    const attachment = cds.context.data
    const items = {
        entityKey: attachment.entityKey,
        documents: [{
            fileName: attachment.fileName,
        }]
    }
    const media_srv = await connectToAttachmentsService()
    await media_srv.onPUT('sap.attachments.Attachments', items)

    return results
}

module.exports = { CreateAttachmentsHandler, ReadImagesHandler }