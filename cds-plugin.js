const fs = require('fs')
const path = require('path')
const cds = require('@sap/cds')

const { getServiceConnection, markResources } = require('./lib/helpers')


cds.on('loaded', async (m) => {
	for (let name in m.definitions) {
		const entity = m.definitions[name]
		// Mark entity with '@attachments: { Image: [], Documents: [] }' which
		// contains a list of keys of the associated type 'Image' or 'Document'
		markResources(entity)
	}
})

// Independent of the data source (db or remote bucket), stream data
// behind app '/media' url
cds.on('bootstrap', async app => {
	app.get('/media/', async (req, res) => {
		let file = req.query.file;
		if (file) {
			const media_srv = await getServiceConnection()
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

			const { ReadHandler } = require('./lib')

			for (const entity of Object.values(srv.entities)) {
				if (entity['@attachments']) {
					const media_srv = await getServiceConnection()

					// Simulates upload of sample data for now
					// TODO: Preferably this should be done via the UI
					await _uploadSampleData(media_srv)

					srv.prepend(() => srv.on("READ", ReadHandler))
				}
			}
		}
	}
})

// Sample data for simulated upload
async function _uploadSampleData(media_srv) {
	const items = [{
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