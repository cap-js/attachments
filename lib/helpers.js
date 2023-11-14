const SERVICE_PLANS = {
	'db-service': {
		name: 'DBAttachmentsService',
		model: '@cap-js/attachments/lib/db-service',
		impl: '@cap-js/attachments/lib/db-service'
	},
	's3-standard': {
		name: 'AWSAttachmentsService',
		model: '@cap-js/attachments/lib/s3-standard',
		impl: '@cap-js/attachments/lib/s3-standard'
	}
}

const connectToAttachmentsService = async () => {
    const attachmentsMeta = cds.env.requires['@cap-js/attachments']
    const plan = attachmentsMeta ? attachmentsMeta['service-plan'] : 'db-service'

	const connectedServices = Object.entries(cds.services).map(([k, v]) => v.name)
	if (connectedServices.includes(SERVICE_PLANS[plan].name)) {
		return Object.values(cds.services).find(s => s.name === SERVICE_PLANS[plan].name)
	}

    if (!Object.keys(SERVICE_PLANS).includes(plan)) {
        throw `❗️ Unknown service plan! Choose from: ${Object.keys(SERVICE_PLANS).join(', ')} ❗️\n`
    }
    return await cds.connect.to(SERVICE_PLANS[plan])
}

const getAssociationsForType = (req, resourceType) => {
	const assocs = []
	if (req?.target?._associations) {
		Object.entries(req.target._associations).forEach(([k, v]) => {
			if (cds?.entities?.[v.target]) {
				const assocImages = cds.entities[v.target]['@attachments']?.[resourceType]
				if (assocImages) {
					assocImages.forEach(img => assocs.push([k, img]))
				}
			}
		})

	}
	return assocs
}

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

module.exports = { getAssociationsForType, connectToAttachmentsService, hasResources }