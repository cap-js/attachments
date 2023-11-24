const cds = require('@sap/cds')

const { ReadAttachmentsHandler, ReadImagesHandler } = require('./lib')
const { connectToAttachmentsService, hasResources } = require('./lib/helpers')


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

			// Add association to AttachmentsView
			const on = [...attachments.on]; keys.forEach((k, i) => { i && on.push('||'); on.push({ ref: [k] }) })
			const assoc = { ...attachments, on }
			const query = entity.projection || entity.query?.SELECT
			if (query) {
			  (query.columns ??= ['*']).push({ as: 'attachments', cast: assoc })
			} else {
			  entity.elements.attachments = assoc
			}

			// Add UI.Facet for AttachmentsView
			entity['@UI.Facets']?.push(facet)

		}
	}
})


cds.on('served', async () => {
	for (const srv of cds.services) {
		if (srv instanceof cds.ApplicationService) {
			let any
			for (const entity of Object.values(srv.entities)) {
				if (entity['@attachments']) {
					any = true
					// This is needed to append image urls to the data
					srv.prepend(() => srv.on("READ", ReadImagesHandler))
				}
			}
			// This is only needed for extra formatting
			if (any && srv.entities.AttachmentsView) {
				//srv.prepend(() => srv.on("READ", srv.entities.AttachmentsView, ReadAttachmentsHandler))
			}
		}
	}
})
