
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
		const store = new ObjectStore(credentials)

		this.on('getObjectAsStream', async (req) => {
			try {
				const res = await store.getObjectAsStream(req.data.fileName)
				return Promise.resolve(res)
			} catch (err) {
				return Promise.reject(err.toString())
			}
		})

		this.on('uploadBulk', async req => {
			try {
				const res = await store.uploadBulk()
				return Promise.resolve(res)
			} catch (err) {
				return Promise.reject(err.toString())
			}
		})

		this.on('emptyBucket', async req => {
			try {
				const res = await store.emptyBucket()
				return Promise.resolve(res)
			} catch (err) {
				return Promise.reject(err.toString())
			}
		})

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


module.exports = { ObjectStoreService }