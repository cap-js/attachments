const cds = require('@sap/cds')

const { SaveHandler, ReadHandler } = require('./lib')
const { hasResources } = require('./lib/helpers')

cds.on('served', async () => {
	for (const srv of cds.services) {
		if (srv instanceof cds.ApplicationService) {
			Object.values(srv.entities) .forEach (entity => {
				for (let e in entity.elements) {
					const element = entity.elements[e]
					if (element.target === 'sap.common.Attachments') {
						return srv.prepend(() => {
							srv.on ("READ", entity, ReadHandler)
							srv.on ("SAVE", entity, SaveHandler)
						})
					}
				}
			})
		}
	}
})
