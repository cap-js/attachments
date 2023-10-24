const cds = require('@sap/cds')

const SERVICE_PLANS = {
	'database': 'DBAttachmentsService',
	'azure-standard': 'AzureAttachmentsService',
	'gcp-standard': 'GCPAttachmentsService',
	's3-standard': 'AWSAttachmentsService'
}

// Make images available to app under <APP_URL>/media
// TODO: Have this on the service where the attachment was annotated
cds.on('bootstrap', async app => {
	app.get('/media/', async (req, res) => {
	  let file = req.query.file;
	  if (file) {

		const { plan } = verifyInput()

		const srvName = SERVICE_PLANS[plan] ? SERVICE_PLANS[plan] : SERVICE_PLANS['database'];
		const srv = await cds.connect.to(srvName)

		// TODO: Get rid of this renaming
		file = file.replace('MediaData', 'sap.capire.incidents.Customers')

		const stream = await srv.onSTREAM(file)
		if (stream) {
			res.setHeader('Content-Type', 'application/octet-stream')
			stream.pipe(res)
		}
	  }
	  return res
	})
})

cds.on('served', async () => {
	// Add READ handler to all services with attachments annotations
	Object.values(cds.services).forEach(s => {
		Object.values(s.entities).forEach(e => {
			const elements = e.elements;
			Object.entries(elements).forEach(([k, v]) => {
				if (e.name === 'MediaData') {
					console.log(`> Registering handler on ${e.name}.${k}`)
					s.prepend(() => s.on('READ', mediaHandler))
				}
			})
		})
	})
})


async function mediaHandler(req, next) {
	const data = await next()

	if (req.http && data) {
	const origin = req.http.req.headers.origin
	const ref = getEntityRef()

	if (data.length && ref) {
			data.map(async (d, i) => {
				if (d && d.customer && ref) {
					let file = `${ref}-${d.customer.ID}.png`
					// TODO: Get rid of this renaming
					file = file.replace('MediaData', 'sap.capire.incidents.Customers')
					Object.assign(d.customer, {
						avatar_url: `${origin}/media/?file=${file}`,
						avatar_fileName: file
					})
				}
			})
		}
	}

	return data
}

function getEntityRef() {
	let ref = []
	Object.values(cds.entities).forEach(c => {
		const elements = c.elements;
		Object.entries(elements).forEach(([k, v]) => {
			if (v['@Core.MediaType'] && !v.parent.projection) { //(v['@title'] === "Attachments:Image" && !v.parent.projection) {
				ref.push(`${c.name}`)
			}
		})
	})
	return ref[0]
}

function verifyInput() {
	const attachmentsMeta = cds.env.requires['@cap-js/attachments']
	const plan = attachmentsMeta ? attachmentsMeta['service-plan'] : 'database'

	if (!Object.keys(SERVICE_PLANS).includes(plan)) {
		throw getMsg('unknown_plan')
	}

	return { plan }
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
