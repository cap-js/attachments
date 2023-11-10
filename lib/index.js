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
    let data = await next()

    // Get associations to types 'Attachments' and 'Image'
    const AttachmentsFromAssocs = getAssociationsForType(req, 'Attachments')

    if (data.length === 0) {
        const media_srv = await getServiceConnection()
        // Add data for attachments
        const srv = req.tx.name
        const ID = req.params[0].ID
        let res = await media_srv.onGET(`${srv}.AttachmentsView`, ID)
        for (const r of res) {
            console.log(r)
            const { fileName, createdAt, createdBy, ...rest } = r
            data.push({ createdAt, createdBy, fileName })
        }
        const count = data.length
        data.$count = count
        console.log(data)
        return data
    }
}

module.exports = { ReadImagesHandler, ReadAttachmentsHandler }