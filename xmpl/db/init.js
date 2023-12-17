const cds = require('@sap/cds')
cds.once('served', async () => {
  const { readFile } = require('fs').promises
  const { join } = require('path')
  const AttachmentsSrv = await cds.connect.to('attachments')
  const data = await SELECT`ID,filename`.from('sap.common.Attachments').where({ content: null })
  // REVISIT: This is not streaming, is it?
  await Promise.all (data.map (d => readFile(join(__dirname, 'data/media', d.filename)).then(b => d.content = b)))
  await AttachmentsSrv.upload(data)
  await UPDATE ('ProcessorService.Customers') .set (`avatar_ID = ID`)
})
