const cds = require('@sap/cds/lib')
module.exports = async function () {
  
  // this ensures customers are in the db already
  cds.once('served', async () => {
    const { 'sap.capire.incidents.Customers': Customers } = cds.model.entities
    await UPDATE (Customers) .set ('avatar_ID = ID')
  })

  const attachments = await cds.connect.to('attachments')
  const { join } = cds.utils.path
  const { createReadStream } = cds.utils.fs

  const { 'sap.capire.incidents.Incidents.attachments': Attachments } = cds.model.entities
  await attachments.initialDataUpload (Attachments, [
    [ '3b23bb4b-4ac7-4a24-ac02-aa10cabd842c', 'INVERTER FAULT REPORT.pdf', 'application/pdf', cds.utils.uuid(),cds.utils.uuid(), 'Unscanned'],
    [ '3b23bb4b-4ac7-4a24-ac02-aa10cabd842c', 'Inverter-error-logs.txt', 'application/txt' , cds.utils.uuid(), cds.utils.uuid(),'Clean'],
    [ '3a4ede72-244a-4f5f-8efa-b17e032d01ee', 'No_Current.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', cds.utils.uuid(), cds.utils.uuid(),'Under Scan'],
    [ '3ccf474c-3881-44b7-99fb-59a2a4668418', 'strange-noise.csv', 'text/csv', cds.utils.uuid(), cds.utils.uuid(),'Malware Detected'],
    [ '3583f982-d7df-4aad-ab26-301d4a157cd7', 'Broken Solar Panel.jpg', 'image/jpeg', cds.utils.uuid(), cds.utils.uuid(),'Clean'],
  ].map(([ up__ID, filename, mimeType, url, ID , status]) => ({
    up__ID, filename, mimeType, url, ID, status,
    content: createReadStream (join(__dirname, 'content', filename)),
    createdAt: new Date (Date.now() - Math.random() * 30*24*60*60*1000),
    createdBy: 'alice',
  })))

  const { 'sap.common.Images': Images } = cds.model.entities
  await attachments.initialDataUpload (Images, [
    [ '1004155', 'Daniel Watts.png', 'image/png', cds.utils.uuid(), 'Clean'],
    [ '1004161', 'Stormy Weathers.png', 'image/png', cds.utils.uuid(), 'Clean'],
    [ '1004100', 'Sunny Sunshine.png', 'image/png', cds.utils.uuid(), 'Clean'],
  ].map(([ ID, filename, mimeType, url, status]) => ({
    ID, filename, mimeType,url, status,
    content: createReadStream (join(__dirname, 'content', filename)),
  })))

}
