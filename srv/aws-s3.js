const { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')
const { Upload } = require("@aws-sdk/lib-storage")
const cds = require("@sap/cds")
const LOG = cds.log('attachments')
const utils = require('../lib/helper')

module.exports = class AWSAttachmentsService extends require("./object-store") {

  /**
   * Creates or retrieves a cached S3 client for the specified tenant
   * @returns {Promise<{client: import('@aws-sdk/client-s3').S3Client, bucket: string}>}
   */
  async retrieveClient() {
    const tenantID = this.separateObjectStore ? cds.context.tenant : 'shared'
    LOG.debug('Retrieving S3 client for', { tenantID })
    const existingClient = this.clientsCache.get(tenantID)
    if (existingClient) {
      LOG.debug('Using cached S3 client', {
        tenantID,
        bucket: existingClient.bucket
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

      const requiredFields = ['bucket', 'region', 'access_key_id', 'secret_access_key']
      const missingFields = requiredFields.filter(field => !credentials[field])

      if (missingFields.length > 0) {
        if (credentials.container_name) {
          throw new Error('Azure Blob Storage found where AWS S3 credentials expected, please check your service bindings.')
        } else if (credentials.projectId) {
          throw new Error('Google Cloud Platform credentials found where AWS S3 credentials expected, please check your service bindings.')
        }
        throw new Error(`Missing Object Store credentials: ${missingFields.join(', ')}`)
      }

      LOG.debug('Creating S3 client', {
        tenantID,
        region: credentials.region,
        bucket: credentials.bucket
      })

      const s3Client = new S3Client({
        region: credentials.region,
        credentials: {
          accessKeyId: credentials.access_key_id,
          secretAccessKey: credentials.secret_access_key,
        },
      })

      const newS3Client = {
        client: s3Client,
        bucket: credentials.bucket,
      }

      this.clientsCache.set(tenantID, newS3Client)

      LOG.debug('s3 client has been created successfully', {
        tenantID,
        bucket: newS3Client.bucket,
        region: credentials.region
      })
      return newS3Client;
    } catch (error) {
      LOG.error(
        'Failed to create tenant-specific S3 client', error,
        'Check Service Manager and Object Store instance configuration',
        { tenantID })
      throw error
    }
  }

  async exists(Key) {
    const { client, bucket } = await this.retrieveClient()
    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key,
        })
      )
      // If no error, object exists
      return true
    } catch (err) {
      // Ignore expected error when object does not exist
      if (err.name === 'NotFound' && err.$metadata?.httpStatusCode === 404) {
        return false
      }
      throw err
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
    LOG.debug('Starting file upload to S3', {
      attachmentEntity: attachments.name,
      tenant: cds.context.tenant
    })

    const { client, bucket } = await this.retrieveClient()

    try {
      const { content, ...metadata } = data
      const Key = metadata.url

      if (!Key) {
        LOG.error(
          'File key/URL is required for S3 upload', null,
          'Ensure attachment data includes a valid URL/key',
          { metadata: { ...metadata, content: !!content } })
        return
      }

      if (!content) {
        LOG.error(
          'File content is required for S3 upload', null,
          'Ensure attachment data includes file content',
          { key: Key, hasContent: !!content })
        return
      }

      if (await this.exists(Key)) {
        const error = new Error('Attachment already exists')
        error.status = 409
        throw error
      }

      const input = {
        Bucket: bucket,
        Key,
        Body: content,
      }

      LOG.info('Uploading file to S3', {
        bucket: bucket,
        key: Key,
        filename: metadata.filename,
        contentSize: content.length || content.size || 'unknown'
      })

      const multipartUpload = new Upload({
        client: client,
        params: input,
      })

      // The file upload has to be done first, so super.put can compute the hash and trigger malware scan
      await multipartUpload.done()
      await super.put(attachments, metadata)

      const duration = Date.now() - startTime
      LOG.debug('File upload to S3 completed successfully', {
        filename: metadata.filename,
        fileId: metadata.ID,
        bucket: bucket,
        key: Key,
        duration
      })
    } catch (err) {
      if (err.status === 409) {
        throw err
      }
      const duration = Date.now() - startTime
      LOG.error(
        'File upload to S3 failed', err,
        'Check S3 connectivity, credentials, and bucket permissions',
        { filename: data?.filename, fileId: data?.ID, bucket: bucket, key: data?.url, duration })
      throw err
    }
  }

  /**
   * @inheritdoc
   */
  async get(attachments, keys) {
    const startTime = Date.now()

    LOG.info('Starting file download from S3', {
      attachmentEntity: attachments.name,
      keys,
      tenant: cds.context.tenant
    })

    const { client, bucket } = await this.retrieveClient()

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

      const Key = response.url

      LOG.debug('Streaming file from S3', {
        bucket: bucket,
        key: Key
      })

      const content = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key,
        })
      )

      const duration = Date.now() - startTime
      LOG.debug('File streamed from S3 successfully', {
        fileId: keys.ID,
        bucket: bucket,
        key: Key,
        duration
      })

      return content.Body

    } catch (error) {
      const duration = Date.now() - startTime
      const suggestion = error.name === 'NoSuchKey' ?
        'File may have been deleted from S3 or URL is incorrect' :
        error.name === 'AccessDenied' ?
          'Check S3 bucket permissions and credentials' :
          'Check S3 connectivity and configuration'

      LOG.error(
        'File download from S3 failed', error,
        suggestion,
        { fileId: keys?.ID, bucket: bucket, attachmentName: attachments.name, duration })

      throw error
    }
  }

  /**
   * Deletes a file from S3 based on the provided key
   * @param {string} Key - The key of the file to delete
   * @returns {Promise} - Promise resolving when deletion is complete
   */
  async delete(Key) {
    const { client, bucket } = await this.retrieveClient()

    const response = await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key,
      })
    )

    if (!response.DeleteMarker) {
      LOG.warn('File was not deleted from S3', { Key, bucket, response })
    }

    return true
  }
}
