const SERVICE_PLANS = {
  'database': 'DBAttachmentsService',
  'azure-standard': 'AzureAttachmentsService',
  'gcp-standard': 'GCPAttachmentsService',
  's3-standard': 'AWSAttachmentsService'
}


const beforeReadAttachmentsView = async (req) => {
  const srv = await _getServiceConnection()

  const source = req.path.replace('/attachments', '')
  const target = req.target.associations['attachmentslist'].target

  // Fill AttachmentsList with data received from connected service
  let items = await srv.onGET(source)
  await srv.onPUT(source, target, items)
}

const _getServiceConnection = async () => {
  const attachmentsMeta = cds.env.requires['@cap-js/attachments']
  const plan = attachmentsMeta ? attachmentsMeta['service-plan'] : 'database'

  if (!Object.keys(SERVICE_PLANS).includes(plan)) {
    throw `❗️ Unknown service plan! Choose from: ${SERVICE_PLANS.join(', ')} ❗️\n`
  }

  const srvName = SERVICE_PLANS[plan] ? SERVICE_PLANS[plan] : SERVICE_PLANS['database'];
  return await cds.connect.to(srvName)
}


module.exports = {
  beforeReadAttachmentsView
}
