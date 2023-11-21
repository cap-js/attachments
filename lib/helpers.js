const SERVICE_PLANS = require("./services.json")


/**
 * Returns instance of specific attachments service connection (i.e. Database, AWS).
 * @returns Service connection
 */
const connectToAttachmentsService = async () => {
    const plan = cds.env.requires['@cap-js/attachments']?.['service-plan'] || 'db-service'
	if (!Object.keys(SERVICE_PLANS).includes(plan)) {
        throw `❗️ Unknown service plan! Choose from: ${Object.keys(SERVICE_PLANS).join(', ')} ❗️\n`
    }

	// Establish new service connection or use existing one.
	const connectedServices = Object.entries(cds.services).map(([k, v]) => v.name)
	// NOTE: We only check for this to get rid of too many print statements
	// Service instances are cached in cds.services and any subsequent connects
	// with the same service name return the initially connected one.
	if (connectedServices.includes(SERVICE_PLANS[plan].name)) {
		return Object.values(cds.services).find(s => s.name === SERVICE_PLANS[plan].name)
	}
    return await cds.connect.to(SERVICE_PLANS[plan])
}

/**
 * Lists all associated elements which have been annotated with type
 * 'Attachments' or 'Image'.
 * @param {*} req Current request
 * @param {*} resourceType Resource type 'Attachments' or 'Image'
 * @returns Object of resource associated elements
 */
const getElementsOfType = (req, resourceType) => {
	const elements = []
	if (req?.target?._associations) {
		Object.entries(req.target._associations).forEach(([k, v]) => {
			if (cds?.entities?.[v.target]) {
				const assocImages = cds.entities[v.target]['@attachments']?.[resourceType]
				if (assocImages) {
					assocImages.forEach(img => elements.push([k, img]))
				}
			}
		})

	}
	return elements
}

/**
 * Checks whether a given entity contains elements of resource type 'Attachments' or 'Image'
 * Also annotates the entity with the detected elements as:
 *    { @attachments: { Attachments: [], Image: [] } }
 * This is necessary so we query for associated elements later on, once the respective type definition
 * has been fully resolved.
 * @param {*} entity CDS entity
 * @returns Boolean whether types 'Attachments' or 'Image' exist
 */
const hasResources = (entity) => {
	const ResourceTypes = ['Attachments', 'Image']
	// At this point, we can still access types 'Image' and 'Document' (before they're resolved)
	// So we mark them here to be accessible with: '@attachments: { Image: [], Document: []}'
	if (entity['@attachments'] || entity.elements && Object.values(entity.elements).some(v => (ResourceTypes.includes(v.type)))) {
		if (!entity['@attachments']) entity['@attachments'] = {};
		Object.entries(entity.elements).forEach(([k, v]) => {
			if (ResourceTypes.includes(v.type)) {
				if (!entity['@attachments'][v.type]) entity['@attachments'][v.type] = [];
				entity['@attachments'][v.type].push(k)
			}
		})
		return true
	}
	return false
}


module.exports = { connectToAttachmentsService, getElementsOfType, hasResources }