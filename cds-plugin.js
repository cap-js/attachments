const fs = require('fs')
const path = require('path')
const cds = require('@sap/cds')

const markResources = (entity) => {
	// At this point, we can still access types 'Image' and 'Document' (before they're resolved)
	// So we mark them here to be accessible with: '@attachments: { Image: [], Document: []}'
	if (entity['@attachments'] || entity.elements && Object.values(entity.elements).some(v => (['Image', 'Document'].includes(v.type)))) {
		if (!entity['@attachments']) entity['@attachments'] = {};
		Object.entries(entity.elements).forEach(([k, v]) => {
			if (['Image', 'Document'].includes(v.type)) {
				if (!entity['@attachments'][v.type]) entity['@attachments'][v.type] = [];
				entity['@attachments'][v.type].push(k)
			}
		})
		return entity
	}
}


cds.on('loaded', async (m) => {
	for (let name in m.definitions) {
		const entity = m.definitions[name]
		markResources(entity)
	}
})

cds.on('bootstrap', async app => {
	app.get('/media/', async (req, res) => {
	  let file = req.query.file;
	  if (file) {

		const media_srv = await _getServiceConnection()

		const stream = await media_srv.onSTREAM(file)
		if (stream) {
			res.setHeader('Content-Type', 'application/octet-stream')
			stream.pipe(res)
		}
	  }
	  return res
	})
})

cds.on('served', async () => {
	for (const srv of cds.services) {
		if (srv instanceof cds.ApplicationService) {
			for (const entity of Object.values(srv.entities)) {
				if (entity['@attachments']) {

					const media_srv = await _getServiceConnection()

					// Upload sample data (preferably UI at later stage)
					await _uploadSampleData(media_srv)

					srv.prepend(() => srv.on("READ", async(req, next) => {
						const data = await next();

						// Get associations to images
						const propsFromAssocs = []
						Object.entries(req.target._associations).forEach(([k, v]) => {
							const assocImages = cds.entities[v.target]['@attachments']?.['Image']
							if (assocImages) {
								assocImages.forEach(img => propsFromAssocs.push([k, img]))
							}
						})

						// Add app urls for image streaming
						if (data) {
							for (const prop of propsFromAssocs) {
								const [k, v] = prop
								if (data?.[k]) {
									// TODO: How do we uniquely identify an asset?
									const res = await media_srv.onGET(`${data[k].name}.png`)
									const fileName = res[0].fileName ? res[0].fileName : res[0].Key
									if (!data[k]?.[v]) data[k] = { [v]: {} };
									data[k][v].url = `/media/?file=${fileName}`
									data[k][v]['url@odata.mediaReadLink'] = `/media/?file=${fileName}`
								}
							}
							return data
						}
					}))
				}
			}
		}
	}
})

const _getServiceConnection = async () => {
	const attachmentsMeta = cds.env.requires['@cap-js/attachments']
	const plan = attachmentsMeta ? attachmentsMeta['service-plan'] : 'db-service'

	const SERVICE_PLANS = {
		'db-service': 'DBAttachmentsService',
		's3-standard': 'AWSAttachmentsService'
	}

	if (!Object.keys(SERVICE_PLANS).includes(plan)) {
	  throw `❗️ Unknown service plan! Choose from: ${SERVICE_PLANS.join(', ')} ❗️\n`
	}

	const srvName = SERVICE_PLANS[plan] ? SERVICE_PLANS[plan] : SERVICE_PLANS['db-service'];
	return await cds.connect.to(srvName)
  }

  async function _uploadSampleData(media_srv) {
	const items = [   {
		ID: '1',
		fileName: 'Daniel Watts.png',
		content: fs.readFileSync(path.join(cds.env._home, 'assets', 'Daniel Watts.png'))
	},
	{
		ID: '2',
		fileName: 'Stormy Weathers.png',
		content: fs.readFileSync(path.join(cds.env._home, 'assets', 'Stormy Weathers.png'))
	},
	{
		ID: '3',
		fileName: 'Sunny Sunshine.png',
		content: fs.readFileSync(path.join(cds.env._home, 'assets', 'Sunny Sunshine.png'))
	}]
	try {
		await media_srv.onPUT(items)
	} catch (err) {
		// TODO: UPSERST instead of INSERT - how to determine unique ID?
	}
  }