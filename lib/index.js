const { getServiceConnection } = require('./helpers')

const ReadHandler = async (req, next) => {
    const data = await next();

    // Get associations to images
    const propsFromAssocs = []
    Object.entries(req.target._associations).forEach(([k, v]) => {
        const assocImages = cds.entities[v.target]['@attachments']?.['Image']
        if (assocImages) {
            assocImages.forEach(img => propsFromAssocs.push([k, img]))
        }
    })

    // Add app urls for image streaming
    const media_srv = await getServiceConnection()
    if (data) {
        for (const prop of propsFromAssocs) {
            const [k, v] = prop
            if (data?.[k]) {
                // TODO: How do we uniquely identify an asset?
                const res = await media_srv.onGET(`${data[k].name}.png`)
                const fileName = res[0].fileName ? res[0].fileName : res[0].Key
                if (!data[k]?.[v]) data[k] = { [v]: {} };
                data[k][v].url = `/media/?file=${fileName}`
                data[k][v]['url@odata.mediaReadLink'] = `/media/?file=${fileName}`
            }
        }
        return data
    }
}

module.exports = { ReadHandler }