const fs = require('fs')
const path = require('path')
const cds = require('@sap/cds')

const { getServiceConnection, hasResources } = require('./lib/helpers')


cds.on('loaded', async (m) => {

	// Get definitions from Dummy entity in our models
	const { 'sap.attachments.aspect': aspect } = m.definitions; if (!aspect) return // some other model
	const { '@UI.Facets': [facet], elements: { attachments } } = aspect
	attachments.on.pop() // remove ID -> filled in below


	for (let name in m.definitions) {
		const entity = m.definitions[name]
		// Mark entity with '@attachments: { Image: [], Documents: [] }' which
		// contains a list of keys of the associated type 'Image' or 'Document'
		if (hasResources(entity)) {

			const keys = [], { elements: elms } = entity
			for (let e in elms) if (elms[e].key) keys.push(e)

			// Add association to ChangeView...
			const on = [...attachments.on]; keys.forEach((k, i) => { i && on.push('||'); on.push({ ref: [k] }) })
			const assoc = { ...attachments, on }
			const query = entity.projection || entity.query?.SELECT
			if (query) {
			  (query.columns ??= ['*']).push({ as: 'attachments', cast: assoc })
			} else {
			  entity.elements.attachments = assoc
			}

			// Add UI.Facet for Change History List
			entity['@UI.Facets']?.push(facet)

		}
	}
})

// Independent of the data source (db or remote bucket), stream data
// behind app '/media' url
cds.on('bootstrap', async app => {
	app.get('/media/', async (req, res) => {
		let ID = req.query.ID;
		if (ID) {
			const media_srv = await getServiceConnection()
			// TODO: Get service dynamically
			const stream = await media_srv.onSTREAM('ProcessorsService.Images', ID)
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

			const { ReadImagesHandler, ReadAttachmentsHandler } = require('./lib')

			let any
			for (const entity of Object.values(srv.entities)) {
				if (entity['@attachments']) {
					any = true
					const media_srv = await getServiceConnection()

					// Simulates upload of sample data for now
					// TODO: Preferably this should be done via the UI
					await _uploadSampleData(media_srv)

					srv.prepend(() => srv.on("READ", ReadImagesHandler))
				}
			}
			if (any && srv.entities.AttachmentsView) {
				srv.prepend(() => srv.on("READ", srv.entities.AttachmentsView, ReadAttachmentsHandler))
			}
		}
	}
})

// Sample data for simulated upload
async function _uploadSampleData(media_srv) {
	const avatars = [
		{
			ID: '8fc8231b-f6d7-43d1-a7e1-725c8e988d18',
			fileName: 'Daniel Watts.png',
			content: fs.readFileSync(path.join(cds.env._home, 'assets', 'Daniel Watts.png'))
		},
		{
			ID: 'feb04eac-f84f-4232-bd4f-80a178f24a17',
			fileName: 'Stormy Weathers.png',
			content: fs.readFileSync(path.join(cds.env._home, 'assets', 'Stormy Weathers.png'))
		},
		{
			ID: '2b87f6ca-28a2-41d6-8c69-ccf16aa6389d',
			fileName: 'Sunny Sunshine.png',
			content: fs.readFileSync(path.join(cds.env._home, 'assets', 'Sunny Sunshine.png'))
		}
	]
	const logs = [
		{
			ID: '3583f982-d7df-4aad-ab26-301d4a157cd7',
			logs: [{
				objectKey: '3583f982-d7df-4aad-ab26-301d4a157cd7',
				documents: {
					ID: '3583f982-d7df-4aad-ab26-301d4a157cd7',
					fileName: 'BrokenSolarPanel.log'
				}
			}]
        },
        {
			ID: '3a4ede72-244a-4f5f-8efa-b17e032d01ee',
			logs: [{
				objectKey: '3a4ede72-244a-4f5f-8efa-b17e032d01ee',
				documents: {
					ID: '3a4ede72-244a-4f5f-8efa-b17e032d01ee',
					fileName: 'NoCurrent.log'
				}
			}]
        },
        {
			ID: '3b23bb4b-4ac7-4a24-ac02-aa10cabd842c',
			logs: [{
				objectKey: '3b23bb4b-4ac7-4a24-ac02-aa10cabd842c',
				documents: {
					ID: '3b23bb4b-4ac7-4a24-ac02-aa10cabd842c',
					fileName: 'BrokenInverter.log'
				}
			}]
        },
        {
			ID: '3ccf474c-3881-44b7-99fb-59a2a4668418',
			logs: [{
				objectKey: '3ccf474c-3881-44b7-99fb-59a2a4668418',
				documents: {
					ID: '3ccf474c-3881-44b7-99fb-59a2a4668418',
					fileName: 'NoisyConverter.log'
				}
			}]
		}
	]
	await media_srv.onPUT('INSERT', 'ProcessorsService.Images', avatars)
	await media_srv.onPUT('UPSERT', 'ProcessorsService.Incidents', logs)
}