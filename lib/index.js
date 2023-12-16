const { connectToAttachmentsService } = require('./helpers')

const ReadHandler = async (req, next) => {

    const imageIsRequested = req?._path ? req._path.endsWith('$value') : false
    const attachmentIsRequested = req?._path ? req._path.endsWith('content') && !req.entity.endsWith('.drafts') : false

    const AttachmentsSrv = await connectToAttachmentsService()
    // TODO: Generalize this by rewriting getElementsOfType() function according to simplified model
    const imageElements = [['customer', 'avatar']] //getElementsOfType(req, 'Image')

    // Add image streaming
    if (imageIsRequested) {
      const ID = req.params[0]
      const { filename } = await SELECT.one.from('sap.common.Attachments').columns('filename')
      const ext = filename.split('.').pop()
      const stream = await AttachmentsSrv.onSTREAM(req.entity, ext, ID)
      return {
        value: stream
      }
    }

    // Add attachment streaming (i.e. for S3 bucket)
    if (attachmentIsRequested && AttachmentsSrv.name !== 'DBAttachmentsService') {
      const { ID } = req.data
      const { filename } = await SELECT.one.from('sap.common.Attachments').where({ ID })
      const ext = filename.split('.').pop()
      const stream = await AttachmentsSrv.onSTREAM(req.entity, ext, ID)
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

  const AttachmentsSrv = await connectToAttachmentsService()

  // Copy attachments from draft to active
  const { Attachments } = this.entities
  const { attachments } = await SELECT.one
    .from(req.target.drafts)
    .columns(i => { i.attachments(a => { a.ID, a.filename, a.content }) })
    .where({ ID: req.data.ID })

  const updates = []
  for (const a of attachments) {
    if (a.content !== null) {
      // Update attachment and content in database
      if (AttachmentsSrv.name === 'DBAttachmentsService') {
        updates.push(UPDATE(Attachments).set({ ID: a.ID, filename: a.filename, content: a.content }).where({ ID: a.ID }))
      } else {
        // Update attachment in database and content in storage (o.e. S3 bucket)
        updates.push(UPDATE(Attachments).set({ ID: a.ID, filename: a.filename }).where({ ID: a.ID }))
        await AttachmentsSrv.onPUT(a.content, a.filename.split('.').pop(), a.ID)
      }
    }
  }
  await Promise.all(updates)

  return results
}

module.exports = { SaveHandler, ReadHandler }
