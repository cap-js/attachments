const cds = require('@sap/cds')

const SERVICE_PLANS = {
	'default': 'AttachmentsService',
	'azure-standard': 'AzureAttachmentsService',
	'gcp-standard': 'GCPAttachmentsService',
	's3-standard': 'AWSAttachmentsService'
}

// Make images available to app under:
// <APP_URL>/media/filename
// TODO: Have this on the service where the attachment was annotated
cds.on('bootstrap', async app => {
  app.get('/media/', async (req, res) => {

    const file = req.query.file;
    if (file) {
      const { plan } = verifyInput()

	  const srvName = SERVICE_PLANS[plan] ? SERVICE_PLANS[plan] : SERVICE_PLANS['default'];

	  const srv = await cds.connect.to(srvName)
      const stream = await srv.onSTREAM(file)

      res.setHeader('Content-Type', 'application/octet-stream')
      stream.pipe(res)
    }

    return res
  })
})

function verifyInput() {
	const attachmentsMeta = cds.env.requires['@cap-js/attachments']
	const plan = attachmentsMeta['service-plan']
	const credentials = attachmentsMeta.credentials

	if (!credentials) {
		throw getMsg('no_credentials')
	}
	if (!Object.keys(SERVICE_PLANS).includes(plan)) {
		throw getMsg('unknown_plan')
	}

	return { credentials, plan }
}

function getMsg(key) {
	let msg;
	switch (key) {
		case 'no_credentials':
			msg = `❗️ No service credentials detected. ❗️\n`
			break
		case 'unknown_plan':
			msg = `❗️ Unknown service plan! Choose from: ${SERVICE_PLANS.join(', ')} ❗️\n`
			break
	}
	return msg
}
