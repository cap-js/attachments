const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')
const { connectToAttachmentsService, getElementsOfType } = require('./helpers')

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

const ReadHandler = async (req, next) => {

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

    let results = await next()
    if (results) {
        // Add image urls
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

const PutHandler = async (req, next) => {
    const results = await next()
    const stream = req._.odataReq._body
    if (stream) {
        const { ID } = results

        const buffer = await stream2buffer(stream)

        // Check to see if streaming worked
        //fs.writeFileSync(path.join(__dirname, 'test.jpeg'), buffer)

        const media_srv = await connectToAttachmentsService()
        await media_srv.onPUT('sap.attachments.Attachments', [{
            ID,
            content: buffer
        }], ID)
    }
}

const CreateHandler = async(req) => {
    if (req?.data) {
        const { ID, fileName, object } = req.data
        if (fileName) {
            const mimeType = 'image/jpeg'
            // req.data = {
            //     object,
            //     documents: [{
            //         fileName,
            //         mimeType
            //     }]
            // }
            const media_srv = await connectToAttachmentsService()
            //await media_srv.onPUT('sap.attachments.Attachments', req.data)
            //
            //req.odataReq.data = {}
        }
    }
}

const SaveHandler = async (req) => {
    if (req?.path && req.path.endsWith('/attachments')) {
        if (req?.method === 'POST') {
            const { ID, fileName, object } = req.data
            mimeType = 'image/jpeg'
            req.context.data = {
                    object,
                    documents: [{
                        fileName,
                        mimeType
                    }]
                }
        }
    }

}


module.exports = { CreateHandler, PutHandler, ReadHandler, SaveHandler }

async function stream2buffer(stream) {
    return new Promise((resolve, reject) => {
        const _buf = [];
        stream.on("data", (chunk) => _buf.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(_buf)));
        stream.on("error", (err) => reject(err));
    });
}
