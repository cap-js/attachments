class ObjectStoreService extends cds.ApplicationService {

	init() {

		console.log('> Init Object Store service\n')
		return super.init()

	}
}

module.exports = { ObjectStoreService }