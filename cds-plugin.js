const cds = require('@sap/cds')

const { PutHandler, ReadHandler } = require('./lib')
const { hasResources } = require('./lib/helpers')

cds.on('served', async () => {
	for (const srv of cds.services) {
		if (srv instanceof cds.ApplicationService) {
			for (const entity of Object.values(srv.entities)) {
				//if (hasResources(entity)) {
				srv.prepend(() => srv.on("READ", ReadHandler))
				//}
			}
			// TODO: Experimental (streams attachments content)
			srv.prepend(() => srv.on("PATCH", `${srv}.Attachments`, PutHandler))
		}
	}
})
