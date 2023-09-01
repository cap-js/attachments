
const path = require('path')
const cds = require('@sap/cds')
//const fsp = require('fs').promises;

//const { execSync } = require('child_process')
//const { Readable } = require('stream');

const SERVICE_PLANS = ['azure-standard', 'gcp-standard', 's3-standard']


class ObjectStoreService extends cds.ApplicationService {

	init() {

		const { credentials, plan } = verifyInput()
		const { ObjectStore } = require(`./plans/${plan}`)
		const store = new ObjectStore(credentials);

		this.on('listObjects', async req => {
			try {
				const attachments = await store.listObjects()
				return Promise.resolve(attachments)
			} catch (err) {
				return Promise.reject(err.toString())
			}
		})

		return super.init()

	}
}

function verifyInput() {
	const attachmentsMeta = cds.env.requires['@cap-js/attachments']
	const plan = attachmentsMeta['service-plan']
	const credentials = attachmentsMeta.credentials

	if (!credentials) {
		throw getMsg('no_credentials')
	}
	if (!SERVICE_PLANS.includes(plan)) {
		throw getMsg('unknown_plan')
	}

	return { credentials, plan }
}

function getMsg(key) {
	let msg;
	switch (key) {
		case 'no_credentials':
			msg = ` ❗️ No service credentials detected. ❗️\n`
			break
		case 'unknown_plan':
			msg = ` ❗️ Unknown service plan! Choose from: ${SERVICE_PLANS.join(', ')} ❗️\n`
			break
	}
	return msg
}

function getAttachmentsByAnnotation() {
        const attachments = []
        const images = []
		console.log(cds)
		Object.values(cds.entities).filter(e => e.compositions).forEach(c => {
            const elements = c.elements;
            Object.entries(elements).forEach(([k, v]) => {
                    if (v.target === 'Documents') {
                        attachments.push(`${c.name}.${k}`)
                    }
                    if (v['@Core.IsMediaType'] && !c.projection) {
                        images.push(`${c.name}.${k.replace('_mediaType', '')}`)
                    }
                })
        })
		return { attachments, images }
}

module.exports = { ObjectStoreService }