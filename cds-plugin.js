const cds = require('@sap/cds')

const { SaveHandler, ReadHandler } = require('./lib')

cds.on('served', async () => {
	const { Attachments } = cds.entities('sap.common')
	Attachments.isMediaEntity = true
	for (const srv of cds.services) {
		if (srv instanceof cds.ApplicationService) {
			Object.values(srv.entities) .forEach (entity => {
				for (let e in entity.elements) {
					if (e === 'SiblingEntity') continue // REVISIT: Why do we have this?
					const element = entity.elements[e]
					if (element._target?.isMediaEntity) {
						// console.debug (entity.name, element.name, '->', element.target)
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
