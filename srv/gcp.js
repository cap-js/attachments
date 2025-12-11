const { Storage } = require('@google-cloud/storage')
const cds = require("@sap/cds")
const LOG = cds.log('attachments')
const utils = require('../lib/helper')

module.exports = class GoogleAttachmentsService extends require("./object-store") {

  /**
   * Creates or retrieves a cached Google Cloud Platform client for the given tenant
   * @returns {Promise<{bucket: import('@google-cloud/storage').Bucket}>}
   */
  async retrieveClient() {
    const tenantID = this.separateObjectStore ? cds.context.tenant : 'shared'
    LOG.debug('Retrieving tenant-specific Google Cloud Platform client', { tenantID })
    const existingClient = this.clientsCache.get(tenantID)
    if (existingClient) {
      LOG.debug('Using cached GCP client', {
        tenantID,
        bucketName: existingClient.bucket.name
      })
      return existingClient
    }

    try {
      LOG.debug(`Fetching object store credentials for tenant ${tenantID}. Using ${this.separateObjectStore ? 'shared' : 'tenant-specific'} object store.`)
      const credentials = this.separateObjectStore
        ? (await utils.getObjectStoreCredentials(tenantID))?.credentials
        : cds.env.requires?.objectStore?.credentials

      if (!credentials) {
        throw new Error("SAP Object Store instance is not bound.")
      }

      // Validate required credentials
      const requiredFields = ['bucket', 'projectId', 'base64EncodedPrivateKeyData']
      const missingFields = requiredFields.filter(field => !credentials[field])

      if (missingFields.length > 0) {
        if (credentials.access_key_id) {
          throw new Error('AWS S3 credentials found where Google Cloud Platform credentials expected, please check your service bindings.')
        } else if (credentials.container_name) {
          throw new Error('Azure credentials found where Google Cloud Platform credentials expected, please check your service bindings.')
        }
        throw new Error(`Missing Google Cloud Platform credentials: ${missingFields.join(', ')}`)
      }

      LOG.debug('Creating Google Cloud Platform client for tenant', {
        tenantID,
        bucketName: credentials.bucket
      })

      const storageClient = new Storage({
        projectId: credentials.projectId,
        credentials: JSON.parse(Buffer.from(credentials.base64EncodedPrivateKeyData, 'base64').toString('utf8'))
      })

      const newGoogleClient = {
        bucket: storageClient.bucket(credentials.bucket),
      }

      this.clientsCache.set(tenantID, newGoogleClient)

      LOG.debug('Google Cloud Platform client has been created successful', {
        tenantID,
        bucketName: newGoogleClient.bucket.name
      })

      return newGoogleClient

    } catch (error) {
      LOG.error(
        'Failed to create tenant-specific Google Cloud Platform client', error,
        'Check Service Manager and Google Cloud Platform instance configuration',
        { tenantID })
      throw error
    }
  }

  /**
  * @inheritdoc
  */
  async put(attachments, data) {
    if (Array.isArray(data)) {
      LOG.debug('Processing bulk file upload', {
        fileCount: data.length,
        filenames: data.map(d => d.filename)
      })
      return Promise.all(
        data.map((d) => this.put(attachments, d))
      )
    }

    const startTime = Date.now()

    LOG.debug('Starting file upload to Google Cloud Platform', {
      attachmentEntity: attachments.name,
      tenant: cds.context.tenant
    })

    const { bucket } = await this.retrieveClient()

    try {
      const { content, ...metadata } = data
      const blobName = metadata.url

      if (!blobName) {
        LOG.error(
          'File key/URL is required for Google Cloud Platform upload', null,
          'Ensure attachment data includes a valid URL/key',
          { metadata: { ...metadata, content: !!content } })
        throw new Error('File key is required for upload')
      }

      if (!content) {
        LOG.error(
          'File content is required for Google Cloud Platform upload', null,
          'Ensure attachment data includes file content',
          { key: blobName, hasContent: !!content })
        throw new Error('File content is required for upload')
      }

      const file = bucket.file(blobName)

      LOG.debug('Uploading file to Google Cloud Platform', {
        bucketName: bucket.name,
        blobName,
        filename: metadata.filename,
        contentSize: content.length || content.size || 'unknown'
      })

      // The file upload has to be done first, so super.put can compute the hash and trigger malware scan
      await file.save(content)
      await super.put(attachments, metadata)

      const duration = Date.now() - startTime
      LOG.debug('File upload to Google Cloud Platform completed successfully', {
        filename: metadata.filename,
        fileId: metadata.ID,
        bucketName: bucket.name,
        blobName,
        duration
      })
    } catch (err) {
      const duration = Date.now() - startTime
      LOG.error(
        'File upload to Google Cloud Platform failed', err,
        'Check Google Cloud Platform connectivity, credentials, and container permissions',
        { filename: data?.filename, fileId: data?.ID, bucketName: bucket.name, blobName: data?.url, duration })
      throw err
    }
  }

  /**
  * @inheritdoc
  */
  async get(attachments, keys) {
    const startTime = Date.now()
    LOG.debug('Starting stream from Google Cloud Platform', {
      attachmentEntity: attachments.name,
      keys,
      tenant: cds.context.tenant
    })
    const { bucket } = await this.retrieveClient()

    try {
      LOG.debug('Fetching attachment metadata', { keys })
      const response = await SELECT.from(attachments, keys).columns("url")

      if (!response?.url) {
        LOG.warn(
          'File URL not found in database', null,
          'Check if the attachment exists and has been properly uploaded',
          { keys, hasResponse: !!response })
        return null
      }

      const blobName = response.url

      LOG.debug('Streaming file from Google Cloud Platform', {
        bucketName: bucket.name,
        blobName
      })

      const file = bucket.file(blobName)
      const [exists] = await file.exists()
      if (!exists) {
        throw new Error('BucketNotFound')
      }
      const readStream = await file.createReadStream()

      const duration = Date.now() - startTime
      LOG.debug('File streamed from Google Cloud Platform successfully', {
        fileId: keys.ID,
        bucketName: bucket.name,
        blobName,
        duration
      })

      return readStream
    } catch (error) {
      const duration = Date.now() - startTime
      const suggestion = error.message === 'BlobNotFound' ?
        'File may have been deleted from Google Cloud Platform or URL is incorrect' :
        error.code === 'AuthenticationFailed' ?
          'Check Google Cloud Platform credentials and SAS token' :
          'Check Google Cloud Platform connectivity and configuration'

      LOG.error(
        'File download from Google Cloud Platform failed', error,
        suggestion,
        { fileId: keys?.ID, bucketName: bucket.name, attachmentName: attachments.name, duration })

      if (error.message === 'BlobNotFound') {
        return null
      }
      
      throw error
    }
  }

  /**
   * Deletes a file from Google Cloud Platform
   * @param {string} Key - The key of the file to delete
   * @returns {Promise} - Promise resolving when deletion is complete
   */
  async delete(blobName) {
    const { bucket } = await this.retrieveClient()
    LOG.debug(`[GCP] Executing delete for file ${blobName} in bucket ${bucket.name}`)

    const file = bucket.file(blobName)
    const response = await file.delete()
    return response[0]?.statusCode === 204
  }
}
