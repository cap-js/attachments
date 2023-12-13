const fs = require('fs')
const { connectToAttachmentsService, getElementsOfType } = require('./helpers')

const ReadHandler = async (req, next) => {

    const imageIsRequested = req?._path ? req._path.endsWith('$value') : false

    const AttachmentsSrv = await connectToAttachmentsService()
    // TODO: Generalize this by rewriting getElementsOfType() function according to simplified model
    const imageElements = [['customer', 'avatar']] //getElementsOfType(req, 'Image')

    // Add image streaming
    if (imageIsRequested) {
      const stream = await AttachmentsSrv.onSTREAM(req.entity, req.params[0])
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

const SaveHandler = async function (req, next) {
  const results = await next()

  // Copy attachments from draft to active
  const { Attachments } = this.entities
  const { attachments } = await SELECT.one
    .from(req.target.drafts)
    .columns(i => { i.attachments(a => { a.ID, a.content }) })
    .where({ ID: req.data.ID })

  const updates = []
  // TODO: This updates the content for the local (database) case only
  // For S3, we need to update the contents in the S3 bucket instead
  for (const each of attachments) updates.push(UPDATE(Attachments).set(each).where({ ID: each.ID }))
  await Promise.all(updates)

  return results
}

module.exports = { SaveHandler, ReadHandler }
