const cds = require('@sap/cds')

const hasAttachments = (entity) => {
	if (entity['@attachments'] || entity.elements && Object.values(entity.elements).some(e => {
		if (['Image', 'Attachments'].includes(e.type)) {
			e['@' + e.type] = true
			return e
		}
	})) {
		entity['@attachments'] = true
		return entity
	}
}

cds.on('loaded', async (m) => {
	// Get definitions from Dummy entity in our models
	const { 'sap.attachments.aspect': aspect } = m.definitions; if (!aspect) return // some other model
	const { '@UI.Facets': [facet], elements: { attachments } } = aspect
	attachments.on.pop() // remove ID -> filled in below

	for (let name in m.definitions) {
		const entity = m.definitions[name]
		if (hasAttachments(entity)) {

			// Determine entity keys
			const keys = [], { elements: elms } = entity
			for (let e in elms) if (elms[e].key) keys.push(e)

			// Add association to AttachmentsView...
			const on = [...attachments.on]; keys.forEach((k, i) => { i && on.push('||'); on.push({ ref: [k] }) })
			const assoc = { ...attachments, on }
			const query = entity.projection || entity.query?.SELECT
			if (query) {
				(query.columns ??= ['*']).push({ as: 'attachments', cast: assoc })
			} else {
				entity.elements.attachments = assoc
			}

			// Add UI.Facet for Attachments List
			entity['@UI.Facets']?.push(facet)
		}
	}
})


cds.on('served', async () => {
	const { beforeReadAttachmentsView } = require("./lib")

	for (const srv of cds.services) {
		if (srv instanceof cds.ApplicationService) {
			let any = false
			for (const entity of Object.values(srv.entities)) {
				if (hasAttachments(entity)) {
					any = true
				}
			}
			if (any && srv.entities.AttachmentsView) {
				srv.before("READ", srv.entities.AttachmentsView, beforeReadAttachmentsView)
			}
		}
	}
})
