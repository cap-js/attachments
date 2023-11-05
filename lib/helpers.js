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

const markResources = (entity) => {
	// At this point, we can still access types 'Image' and 'Document' (before they're resolved)
	// So we mark them here to be accessible with: '@attachments: { Image: [], Document: []}'
	if (entity['@attachments'] || entity.elements && Object.values(entity.elements).some(v => (['Image', 'Document'].includes(v.type)))) {
		if (!entity['@attachments']) entity['@attachments'] = {};
		Object.entries(entity.elements).forEach(([k, v]) => {
			if (['Image', 'Document'].includes(v.type)) {
				if (!entity['@attachments'][v.type]) entity['@attachments'][v.type] = [];
				entity['@attachments'][v.type].push(k)
			}
		})
		return entity
	}
}

module.exports = { getServiceConnection, markResources }