const getServiceConnection = async () => {
    const attachmentsMeta = cds.env.requires['@cap-js/attachments']
    const plan = attachmentsMeta ? attachmentsMeta['service-plan'] : 'db-service'

    const SERVICE_PLANS = {
        'db-service': 'DBAttachmentsService',
        's3-standard': 'AWSAttachmentsService'
    }

    if (!Object.keys(SERVICE_PLANS).includes(plan)) {
        throw `❗️ Unknown service plan! Choose from: ${SERVICE_PLANS.join(', ')} ❗️\n`
    }

    const srvName = SERVICE_PLANS[plan] ? SERVICE_PLANS[plan] : SERVICE_PLANS['db-service'];
    return await cds.connect.to(srvName)
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

module.exports = { getAssociationsForType, getServiceConnection, hasResources }