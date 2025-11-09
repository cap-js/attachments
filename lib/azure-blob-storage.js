const { BlobServiceClient } = require('@azure/storage-blob')
const cds = require("@sap/cds")
const utils = require('./helper')
const { SELECT } = cds.ql
const { logConfig } = require('./logger')

const isMultiTenancyEnabled = !!cds.env.requires.multitenancy
const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind
const separateObjectStore = isMultiTenancyEnabled && objectStoreKind === "separate"

module.exports = class AzureAttachmentsService extends require("./basic") {

  clientsCache = new Map()
  
  /**
   * Initializes the Azure Blob Storage Attachments Service
   */
  init() {
    // Log initial configuration
    logConfig.info('Azure Blob Storage Attachments Service initialization', {
      multiTenancy: isMultiTenancyEnabled,
      objectStoreKind,
      separateObjectStore,
      attachmentsConfig: {
        kind: cds.env.requires?.attachments?.kind,
        scan: cds.env.requires?.attachments?.scan
      }
    })

    this.on('DeleteAttachment', async msg => {
      await this.delete(msg.url)
    })

    this.on('DeleteInfectedAttachment', async msg => {
      const { target, hash, keys } = msg.data
      const attachment = await SELECT.one.from(target).where(Object.assign({ hash }, keys)).columns('url')
      if (attachment) { //Might happen that a draft object is the target
        await this.delete(attachment.url)
      } else {
        logConfig.warn(`Cannot delete malware file with the hash ${hash} for attachment ${target}, keys: ${keys}`)
      }
    })

    return super.init()
  }

  /**
   * 
   * @returns {Promise<import('@azure/storage-blob').ContainerClient>}
   */
  async getContainerClient() {
      const cacheKey = separateObjectStore ? cds.context.tenant : 'shared'
      const existingClient = this.clientsCache.get(cacheKey);
      if (existingClient) {
        return existingClient.containerClient
      } else {
        return (await this.createAzureClient(cacheKey)).containerClient;
      }
    }

  /**
   * Creates or retrieves a cached Azure Blob Storage client for the given tenant
   * @param {String} tenantID - The tenant ID for which to create/retrieve the client
   * @returns {Promise<{blobServiceClient: import('@azure/storage-blob').BlobServiceClient, containerClient: import('@azure/storage-blob').ContainerClient}>}
   */
  async createAzureClient(tenantID) {
    logConfig.info('Creating tenant-specific Azure Blob Storage client', { tenantID })

    const existingClient = this.clientsCache.get(tenantID)
    if (existingClient) {
      logConfig.debug('Using cached Azure Blob Storage client', {
        tenantID,
        containerName: existingClient.containerClient.containerName
      })
      return existingClient
    }

    try {
      logConfig.debug('Fetching object store credentials for tenant', { tenantID })
      const credentials = separateObjectStore 
        ? (await utils.getObjectStoreCredentials(tenantID))?.credentials
        : cds.env.requires?.objectStore?.credentials

      if (!credentials) {
        if (Object.keys(credentials).includes('access_key_id')) {
          throw new Error('AWS S3 credentials found where Azure Blob Storage credentials expected, please check your service bindings.')
        } else if (Object.keys(credentials).includes('projectId')) {
          throw new Error('Google Cloud Platform credentials found where Azure Blob Storage credentials expected, please check your service bindings.')
        }
        throw new Error("SAP Object Store instance is not bound.")
      }

      // Validate required credentials
      const requiredFields = ['container_name', 'container_uri', 'sas_token']
      const missingFields = requiredFields.filter(field => !credentials[field])

      if (missingFields.length > 0) {
        logConfig.configValidation('objectStore.credentials', credentials, false,
          `Azure Blob Storage credentials missing: ${missingFields.join(', ')}`)
        throw new Error(`Missing Azure Blob Storage credentials: ${missingFields.join(', ')}`)
      }

      logConfig.debug('Creating Azure Blob Storage client for tenant', {
        tenantID,
        containerName: credentials.container_name
      })

      const blobServiceClient = new BlobServiceClient(credentials.container_uri + "?" + credentials.sas_token)
      const containerClient = blobServiceClient.getContainerClient(credentials.container_name)

      const newAzureCredentials = {
        containerClient,
      }

      this.clientsCache.set(tenantID, newAzureCredentials)

      logConfig.debug('Azure Blob Storage client has been created successful', {
        tenantID,
        containerName: containerClient.containerName
      })
      return newAzureCredentials;
    } catch (error) {
      logConfig.withSuggestion('error',
        'Failed to create tenant-specific Azure Blob Storage client', error,
        'Check Service Manager and Azure Blob Storage instance configuration',
        { tenantID })
      throw error
    }
  }

  /**
  * @inheritdoc
  */
  async put(attachments, data, isDraftEnabled, _content, req) {
    const startTime = Date.now()

    logConfig.processStep('Starting file upload to Azure Blob Storage', {
      attachmentEntity: attachments.name,
      isDraftEnabled,
      tenant: req?.tenant
    })
    const containerClient = await this.getContainerClient();
    try {
      if (Array.isArray(data)) {
        logConfig.debug('Processing bulk file upload', {
          fileCount: data.length,
          filenames: data.map(d => d.filename)
        })
        return Promise.all(
          data.map((d) => this.put(attachments, d, isDraftEnabled, _content, req))
        )
      }

      const { content = _content, ...metadata } = data
      const blobName = metadata.url

      if (!blobName) {
        logConfig.withSuggestion('error',
          'File key/URL is required for Azure Blob Storage upload', null,
          'Ensure attachment data includes a valid URL/key',
          { metadata: { ...metadata, content: !!content } })
        throw new Error('File key is required for upload')
      }

      if (!content) {
        logConfig.withSuggestion('error',
          'File content is required for Azure Blob Storage upload', null,
          'Ensure attachment data includes file content',
          { key: blobName, hasContent: !!content })
        throw new Error('File content is required for upload')
      }

      const blobClient = containerClient.getBlockBlobClient(blobName)

      logConfig.debug('Uploading file to Azure Blob Storage', {
        containerName: containerClient.containerName,
        blobName,
        filename: metadata.filename,
        contentSize: content.length || content.size || 'unknown'
      })

      const stored = super.put(attachments, metadata, null, isDraftEnabled)
      await Promise.all([stored, blobClient.uploadData(content)])

      const duration = Date.now() - startTime
      logConfig.debug('File upload to Azure Blob Storage completed successfully', {
        filename: metadata.filename,
        fileId: metadata.ID,
        containerName: containerClient.containerName,
        blobName,
        duration
      })

      // Initiate malware scan if configured
      logConfig.debug('Initiating malware scan for uploaded file', {
        fileId: metadata.ID,
        filename: metadata.filename
      })

      const MalwareScanner = await cds.connect.to('malwareScanner')
      await MalwareScanner.emit('ScanFile', { target: attachments.name, keys: { ID: metadata.ID } })
    } catch (err) {
      const duration = Date.now() - startTime
      logConfig.withSuggestion('error',
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

    const tenantID = cds.context.tenant

    logConfig.processStep('Starting stream from Azure Blob Storage', {
      attachmentEntity: attachments.name,
      keys,
      tenant: tenantID
    })
    const containerClient = await this.getContainerClient();

    try {
      logConfig.debug('Fetching attachment metadata', { keys })
      const response = await SELECT.from(attachments, keys).columns("url")

      if (!response?.url) {
        logConfig.withSuggestion('warn',
          'File URL not found in database', null,
          'Check if the attachment exists and has been properly uploaded',
          { keys, hasResponse: !!response })
        return null
      }

      const blobName = response.url

      logConfig.debug('Streaming file from Azure Blob Storage', {
        containerName: containerClient.containerName,
        blobName
      })

      const blobClient = containerClient.getBlockBlobClient(blobName)
      const downloadResponse = await blobClient.download()

      const duration = Date.now() - startTime
      logConfig.debug('File streamed from Azure Blob Storage successfully', {
        fileId: keys.ID,
        containerName: containerClient.containerName,
        blobName,
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

      logConfig.withSuggestion('error',
        'File download from Azure Blob Storage failed', error,
        suggestion,
        { fileId: keys?.ID, containerName: containerClient.containerName, attachmentName: attachments.name, duration })

      throw error
    }
  }

  /**
   * Registers attachment handlers for the given service and entity
   * @param {import('@sap/cds').Request} req - The request object
   * @param {import('express').NextFunction} next - The next middleware function
   */
  async updateContentHandler(req, next) {
    logConfig.debug(`[Azure] Uploading file using updateContentHandler for ${req.target.name}`)
    const targetID = req.data.ID || req.params[1]?.ID || req.params[1]
    if (!targetID) {
      req.reject(400, "Missing ID in request")
    }

    if (req?.data?.content) {
      const response = await SELECT.from(req.target, { ID: targetID }).columns("url")
      if (response?.url) {
        const containerClient = await this.getContainerClient();
        const blobName = response.url
        const blobClient = containerClient.getBlockBlobClient(blobName)

        // Handle different content types for update
        let contentLength
        const content = req.data.content
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
          req.data.content = Buffer.concat(chunks)
          contentLength = req.data.content.length
        }

        await blobClient.upload(req.data.content, contentLength)

        const hash = await utils.computeHash(await this.get(req.target, { ID: targetID }))
        await super.update(req.target, { ID: targetID }, { hash })

        const MalwareScanner = await cds.connect.to('malwareScanner')
        await MalwareScanner.emit('ScanFile', { target: req.target.name, keys: { ID: targetID } })

        logConfig.debug(`[Azure] Uploaded file using updateContentHandler for ${req.target.name}`)
      }
    } else if (req?.data?.note) {
      const key = { ID: targetID }
      await super.update(req.target, key, { note: req.data.note })
      logConfig.debug(`[Azure] Updated file upload with note for ${req.target.name}`)
    } else {
      next()
    }
  }

  /**
   * @inheritdoc
   */
  registerUpdateHandlers(srv) {
      srv.prepend(() => {
        srv.on(
          "PUT",
          (req, next) => {
            if (!req.target._attachments.isAttachmentsEntity) return next();
            return this.updateContentHandler.bind(this)(req, next)
          }
        )
      })
  }

  /**
   * @inheritdoc
   */
  registerDraftUpdateHandlers(srv) {
    // case: attachments uploaded in draft and deleted before saving
    srv.before(
      "DELETE",
      (req) => {
        if (!req.target.isDraft || !req.target._attachments.isAttachmentsEntity) return;
        return this.attachDraftDeletionData.bind(this)(req)
      }
    )
    srv.after(
      "DELETE",
      (res, req) => {
        if (!req.target.isDraft || !req.target._attachments.isAttachmentsEntity) return;
        return this.deleteAttachmentsWithKeys.bind(this)(res, req)
      }
    )
    srv.prepend(() => {
        srv.on(
          "PUT",
          (req, next) => {
            if (!req.target.isDraft || !req.target._attachments.isAttachmentsEntity) return next();
            return this.updateContentHandler.bind(this)(req, next)
          }
        )
    })
  }

  /**
   * Deletes a file from Azure Blob Storage
   * @param {string} Key - The key of the file to delete
   * @returns {Promise} - Promise resolving when deletion is complete
   */
  async delete(blobName) {
    const containerClient = await this.getContainerClient();
    logConfig.debug(`[Azure] Executing delete for file ${blobName} in bucket ${containerClient.containerName}`)

    const blobClient = containerClient.getBlockBlobClient(blobName)
    const response = await blobClient.delete()
    return response._response.status === 202
  }
}
