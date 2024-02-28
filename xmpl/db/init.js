const cds = require('@sap/cds/lib')
module.exports = async function () {
  const attachments = await cds.connect.to('attachments')
  const { join } = cds.utils.path
  const { createReadStream } = cds.utils.fs

  const { 'sap.capire.incidents.Incidents.attachments': Attachments } = cds.model.entities
  await attachments.put (Attachments, [
    [ '3b23bb4b-4ac7-4a24-ac02-aa10cabd842c', 'INVERTER FAULT REPORT.pdf', 'application/pdf' ],
    [ '3b23bb4b-4ac7-4a24-ac02-aa10cabd842c', 'Inverter-error-logs.txt', 'application/txt' ],
    [ '3a4ede72-244a-4f5f-8efa-b17e032d01ee', 'No_Current.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ],
    [ '3ccf474c-3881-44b7-99fb-59a2a4668418', 'strange-noise.csv', 'text/csv' ],
    [ '3583f982-d7df-4aad-ab26-301d4a157cd7', 'Broken Solar Panel.jpg', 'image/jpeg' ]
  ].map(([ up__ID, filename, mimeType ]) => ({
    up__ID, filename, mimeType, 
    content: createReadStream (join(__dirname, 'content', filename)),
    createdAt: new Date (Date.now() - Math.random() * 30*24*60*60*1000),
    createdBy: 'alice',
  })))

  const { 'sap.common.Images': Images } = cds.model.entities
  await attachments.put (Images, [
    [ '8fc8231b-f6d7-43d1-a7e1-725c8e988d18', 'Daniel Watts.png', 'image/png' ],
    [ 'feb04eac-f84f-4232-bd4f-80a178f24a17', 'Stormy Weathers.png', 'image/png' ],
    [ '2b87f6ca-28a2-41d6-8c69-ccf16aa6389d', 'Sunny Sunshine.png', 'image/png' ],
  ].map(([ ID, filename, mimeType ]) => ({
    ID, filename, mimeType,
    content: createReadStream (join(__dirname, 'content', filename)),
  })))

  const { 'sap.capire.incidents.Customers': Customers } = cds.model.entities
  await UPDATE (Customers) .set ('avatar_ID = ID')
}
