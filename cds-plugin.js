const cds = require('@sap/cds')

const { SaveHandler, ReadHandler } = require('./lib')
const { hasResources } = require('./lib/helpers')

cds.on('served', async () => {
	for (const srv of cds.services) {
		if (srv instanceof cds.ApplicationService) {
			for (const entity of Object.values(srv.entities)) {
				//if (hasResources(entity)) {
				srv.prepend((impl) => impl.on("READ", ReadHandler))
				//}
			}
			// TODO: Experimental (streams attachments content)
			const { Incidents } = srv.entities
			srv.prepend((impl) => impl.on("SAVE", Incidents, SaveHandler))
		}
	}
})
