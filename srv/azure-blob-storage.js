const { BlobServiceClient } = require('@azure/storage-blob')
const cds = require("@sap/cds")
const LOG = cds.log('attachments')
const utils = require('../lib/helper')

module.exports = class AzureAttachmentsService extends require("./object-store") {

  /**
   * Creates or retrieves a cached Azure Blob Storage client for the given tenant
   * @returns {Promise<{blobServiceClient: import('@azure/storage-blob').BlobServiceClient, containerClient: import('@azure/storage-blob').ContainerClient}>}
   */
  async retrieveClient() {
    const tenantID = this.separateObjectStore ? cds.context.tenant : 'shared'
    LOG.debug('Retrieving tenant-specific Azure Blob Storage client', { tenantID })

    const existingClient = this.clientsCache.get(tenantID)
    if (existingClient) {
      LOG.debug('Using cached Azure Blob Storage client', {
        tenantID,
        containerName: existingClient.containerClient.containerName
      })
      return existingClient
    }

    try {
      LOG.debug('Fetching object store credentials for tenant', { tenantID })
      const credentials = this.separateObjectStore
        ? (await utils.getObjectStoreCredentials(tenantID))?.credentials
        : cds.env.requires?.objectStore?.credentials

      if (!credentials) {
        throw new Error("SAP Object Store instance is not bound.")
      }

      const requiredFields = ['container_name', 'container_uri', 'sas_token']
      const missingFields = requiredFields.filter(field => !credentials[field])

      if (missingFields.length > 0) {
        if (credentials.access_key_id) {
          throw new Error('AWS S3 credentials found where Azure Blob Storage credentials expected, please check your service bindings.')
        } else if (credentials.projectId) {
          throw new Error('Google Cloud Platform credentials found where Azure Blob Storage credentials expected, please check your service bindings.')
        }
        throw new Error(`Missing Azure Blob Storage credentials: ${missingFields.join(', ')}`)
      }

      LOG.debug('Creating Azure Blob Storage client for tenant', {
        tenantID,
        containerName: credentials.container_name
      })

      const blobServiceClient = new BlobServiceClient(credentials.container_uri + "?" + credentials.sas_token)
      const containerClient = blobServiceClient.getContainerClient(credentials.container_name)

      const newAzureCredentials = {
        containerClient,
      }

      this.clientsCache.set(tenantID, newAzureCredentials)

      LOG.debug('Azure Blob Storage client has been created successful', {
        tenantID,
        containerName: containerClient.containerName
      })
      return newAzureCredentials;
    } catch (error) {
      LOG.error(
        'Failed to create tenant-specific Azure Blob Storage client', error,
        'Check Service Manager and Azure Blob Storage instance configuration',
        { tenantID })
      throw error
    }
  }

  async exists(blobClient) {
    try {
      await blobClient.getProperties()
      // If no error, blob exists
      return true
    } catch (err) {
      // Ignore expected error when blob does not exist
      if (err.statusCode === 404 && err.code === 'BlobNotFound') {
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

    LOG.debug('Starting file upload to Azure Blob Storage', {
      attachmentEntity: attachments.name,
      tenant: cds.context.tenant
    })
    const { containerClient } = await this.retrieveClient()
    try {
      let { content: _content, ...metadata } = data
      const blobName = metadata.url

      if (!blobName) {
        LOG.error(
          'File key/URL is required for Azure Blob Storage upload', null,
          'Ensure attachment data includes a valid URL/key',
          { metadata: { ...metadata, content: !!_content } })
        throw new Error('File key is required for upload')
      }

      if (!_content) {
        LOG.error(
          'File content is required for Azure Blob Storage upload', null,
          'Ensure attachment data includes file content',
          { key: blobName, hasContent: !!_content })
        throw new Error('File content is required for upload')
      }

      const blobClient = containerClient.getBlockBlobClient(blobName)

      if (await this.exists(blobClient)) {
        const error = new Error('Attachment already exists')
        error.status = 409
        throw error
      }

      LOG.debug('Uploading file to Azure Blob Storage', {
        containerName: containerClient.containerName,
        blobName,
        filename: metadata.filename,
        contentSize: _content.length || _content.size || 'unknown'
      })

      // Handle different content types for update
      let contentLength
      const content = _content
      if (Buffer.isBuffer(content)) {
        contentLength = content.length
      } else if (content && typeof content.length === 'number') {
        contentLength = content.length
      } else if (content && typeof content.size === 'number') {
        contentLength = content.size
      } else {
        // Convert to buffer if needed
        const chunks = []
        for await (const chunk of content) {
          chunks.push(chunk)
        }
        _content = Buffer.concat(chunks)
        contentLength = _content.length
      }

      // The file upload has to be done first, so super.put can compute the hash and trigger malware scan
      await blobClient.upload(_content, contentLength)
      await super.put(attachments, metadata)

      const duration = Date.now() - startTime
      LOG.debug('File upload to Azure Blob Storage completed successfully', {
        filename: metadata.filename,
        fileId: metadata.ID,
        containerName: containerClient.containerName,
        blobName,
        duration
      })
    } catch (err) {
      if (err.status === 409) {
        throw err
      }
      const duration = Date.now() - startTime
      LOG.error(
        'File upload to Azure Blob Storage failed', err,
        'Check Azure Blob Storage connectivity, credentials, and container permissions',
        { filename: data?.filename, fileId: data?.ID, containerName: containerClient.containerName, blobName: data?.url, duration })
      throw err
    }
  }

  /**
  * @inheritdoc
  */
  async get(attachments, keys) {
    const startTime = Date.now()
    LOG.debug('Starting stream from Azure Blob Storage', {
      attachmentEntity: attachments.name,
      keys,
      tenant: cds.context.tenant
    })
    const { containerClient } = await this.retrieveClient()

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

      LOG.debug('Streaming file from Azure Blob Storage', {
        containerName: containerClient.containerName,
        fileId: keys.ID,
        blobName: response.url
      })

      const blobClient = containerClient.getBlockBlobClient(response.url)
      const downloadResponse = await blobClient.download()

      const duration = Date.now() - startTime
      LOG.debug('File streamed from Azure Blob Storage successfully', {
        fileId: keys.ID,
        duration
      })

      return downloadResponse.readableStreamBody
    } catch (error) {
      const duration = Date.now() - startTime
      const suggestion = error.code === 'BlobNotFound' ?
        'File may have been deleted from Azure Blob Storage or URL is incorrect' :
        error.code === 'AuthenticationFailed' ?
          'Check Azure Blob Storage credentials and SAS token' :
          'Check Azure Blob Storage connectivity and configuration'

      LOG.error(
        'File download from Azure Blob Storage failed', error,
        suggestion,
        { fileId: keys?.ID, containerName: containerClient.containerName, attachmentName: attachments.name, duration })

      throw error
    }
  }

  /**
   * Deletes a file from Azure Blob Storage
   * @param {string} Key - The key of the file to delete
   * @returns {Promise} - Promise resolving when deletion is complete
   */
  async delete(blobName) {
    const { containerClient } = await this.retrieveClient()
    LOG.debug(`[Azure] Executing delete for file ${blobName} in bucket ${containerClient.containerName}`)

    const blobClient = containerClient.getBlockBlobClient(blobName)
    const response = await blobClient.delete()
    return response._response.status === 202
  }
}
