const { Readable } = require('stream')
const { connectToAttachmentsService, getElementsOfType } = require('./helpers')
const fs = require('fs')
const path = require('path')


const defaultContentType = "text/plain;charset=UTF-8";
const contentTypes = {
  txt: "text/plain;charset=UTF-8",
  js: "application/javascript",
  json: "application/json",
  csv: "text/csv",
  css: "text/css",
  html: "text/html",
  htm: "text/html",
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpg",
  gif: "image/gif",
  mp4: "video/mp4",
  ico: "image/vnd.microsoft.icon",
};

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

CreateAttachmentsHandler = async (req, next) => {
    let results = await next()

    // Store attachment
    const mimeType = req.headers['content-type']
    const attachment = cds.context.data
    const { ID, fileName, ...rest} = attachment
    const baseUrl = req?.req?.baseUrl || 'http://localhost:4004'
    const url = `${baseUrl}/AttachmentsView(${ID})/content/$value`

    results = Object.assign(results, {
        fileName,
        mimeType,
        url,
    })

    return results
}

const PutAttachmentsHandler = async (req, next) => {
    let results = await next()

    const stream = req._.odataReq._body
    if (stream) {
        const { ID } = results

        const buffer = await stream2buffer(stream)
        //fs.writeFileSync(path.join(__dirname, 'test.png'), buffer)

        const media_srv = await connectToAttachmentsService()
        await media_srv.onPUT('sap.attachments.Attachments', [{
            ID,
            entityKey: ID,
            documents: {
                ID,
                content: buffer
            }
        }], ID)
    }

    return results
}

module.exports = { CreateAttachmentsHandler, PutAttachmentsHandler, ReadImagesHandler }

async function stream2buffer(stream) {
    return new Promise((resolve, reject) => {
        const _buf = [];
        stream.on("data", (chunk) => _buf.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(_buf)));
        stream.on("error", (err) => reject(err));
    });
}
