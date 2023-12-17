// This is for demo purposes only, not for production use!

const cds = require('@sap/cds')
cds.once('served', async () => {
  const Attachments = await cds.connect.to('attachments')
  const attachments = await SELECT `ID, filename` .from `sap.common.Attachments` .where `content is null`
  await Promise.all (attachments.map(_init))
  await Attachments.upload(attachments)
  await UPDATE `ProcessorService.Customers` .set `avatar_ID = ID`
})

// Helpers...
const { join } = require('path'), _content = join(__dirname, 'content')
const { readFile } = require('fs').promises
const _init = a => readFile(join(_content, a.filename)).then(c => a.content = c)
// REVISIT: This ^^^ is not streaming, is it?