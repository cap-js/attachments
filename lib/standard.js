const cds = require("@sap/cds")

module.exports = class StandardAttachmentsService extends require("./object-store") {

  attachmentsService = null

  init() {
    const srvFactory = cds.env.requires?.objectStore?.credentials?.access_key_id
      ? require('./aws-s3')
      : cds.env.requires?.objectStore?.credentials?.container_name
        ? require('./azure-blob-storage')
        : cds.env.requires?.objectStore?.credentials?.projectId
          ? require('./gcp')
          : require('./aws-s3')
      this.attachmentsService = new srvFactory();
  }

  /**
  * @inheritdoc
  */
  async put() {
    return this.attachmentsService.put(...arguments)
  }

  /**
  * @inheritdoc
  */
  async get() {
    return this.attachmentsService.get(...arguments)
  }

  /**
   * @inheritdoc
   */
  async updateContentHandler() {
    return this.attachmentsService.updateContentHandler(...arguments)
  }

  /**
   * @inheritdoc
   */
  async delete() {
    return this.attachmentsService.delete(...arguments)
  }
}
