const { getServiceConnection, getAssociationsForType } = require('./helpers')

const ReadImagesHandler = async (req, next) => {
    const data = await next();

    // Get associations to type 'Image'
    const ImagesFromAssocs = getAssociationsForType(req, 'Image')

    const srv = req.tx.name
    const media_srv = await getServiceConnection()
    if (data) {
        // Add app urls for image streaming
        for (const prop of ImagesFromAssocs) {
            const [k, v] = prop
            if (data?.[k]) {
                const ID = data[k].ID
                const res = await media_srv.onGET(`${srv}.Images`, ID)
                if (!data[k]?.[v]) data[k] = Object.assign(data[k], { [v]: {} });
                data[k][v].url = `/media/?ID=${ID}`
                data[k][v]['url@odata.mediaReadLink'] = `/media/?ID=${ID}`
            }
        }
        return data
    }
}

const ReadAttachmentsHandler = async (req, next) => {
    const data = await next();

    // Get associations to types 'Attachments' and 'Image'
    const AttachmentsFromAssocs = getAssociationsForType(req, 'Attachments')

    const srv = req.tx.name
    const media_srv = await getServiceConnection()
    // Add data for attachments
    const res = await media_srv.onGET(`ProcessorsService.Incidents`)
    const res2 = await media_srv.onGET(`ProcessorsService.Attachments`)
    console.log(res, req.path)
    return res
}

module.exports = { ReadImagesHandler, ReadAttachmentsHandler }