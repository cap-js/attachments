const { BlobServiceClient } = require('@azure/storage-blob')
const { scanRequest } = require('./malwareScanner')
const cds = require("@sap/cds")
const utils = require('./helper')
const { SELECT } = cds.ql
const { logConfig } = require('./logger')

const isMultitenacyEnabled = !!cds.env.requires.multitenancy
const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind
const separateObjectStore = isMultitenacyEnabled && objectStoreKind === "separate"

const azureClientsCache = {}
module.exports = class AzureAttachmentsService extends require("./basic") {
  /**
   * Initializes the Azure Blob Storage Attachments Service
   */
  init() {
    // Log initial configuration
    logConfig.info('Azure Blob Storage Attachments Service initialization', {
      multitenancy: isMultitenacyEnabled,
      objectStoreKind,
      separateObjectStore,
      attachmentsConfig: {
        kind: cds.env.requires?.attachments?.kind,
        scan: cds.env.requires?.attachments?.scan
      }
    })

    logConfig.processStep('Initializing Azure Blob Storage Attachments Service', {
      separateObjectStore
    })

    // For single tenant or shared object store instance
    if (!separateObjectStore) {
      const creds = cds.env.requires?.objectStore?.credentials

      if (!creds) {
        if (Object.keys(creds).includes('bucket')) {
          throw new Error('AWS S3 credentials found where Azure Blob Storage credentials expected, please check your service bindings.')
        }
        throw new Error("SAP Object Store instance is not bound.")
      }

      // Validate required credentials
      const requiredFields = ['container_name', 'container_uri', 'sas_token']
      const missingFields = requiredFields.filter(field => !creds[field])

      if (missingFields.length > 0) {
        logConfig.configValidation('objectStore.credentials', creds, false,
          `Azure Blob Storage credentials missing: ${missingFields.join(', ')}`)
        throw new Error(`Missing Azure Blob Storage credentials: ${missingFields.join(', ')}`)
      }

      logConfig.info('Configuring shared Azure Blob Storage client', {
        containerName: creds.container_name,
        containerUri: creds.container_uri,
        hasSasToken: !!creds.sas_token
      })

      this.containerName = creds.container_name
      this.blobServiceClient = new BlobServiceClient(creds.container_uri + "?" + creds.sas_token)
      this.containerClient = this.blobServiceClient.getContainerClient(creds.container_name)

      logConfig.info('Azure Blob Storage client initialized successfully', {
        containerName: this.containerName
      })

      return super.init()
    } else {
      logConfig.info('Separate object store mode enabled - clients will be created per tenant')
    }
  }

  /**
   * Creates or retrieves a cached Azure Blob Storage client for the given tenant
   * @param {String} tenantID - The tenant ID for which to create/retrieve the client
   */
  async createAzureClient(tenantID) {
    logConfig.processStep('Creating tenant-specific Azure Blob Storage client', { tenantID })

    try {
      // Check cache first
      if (azureClientsCache[tenantID]) {
        logConfig.debug('Using cached Azure Blob Storage client', {
          tenantID,
          containerName: azureClientsCache[tenantID].containerName
        })
        this.blobServiceClient = azureClientsCache[tenantID].blobServiceClient
        this.containerClient = azureClientsCache[tenantID].containerClient
        this.containerName = azureClientsCache[tenantID].containerName
        return
      }

      // Validate Service Manager configuration
      const serviceManagerCreds = cds.env.requires?.serviceManager?.credentials
      if (!serviceManagerCreds) {
        logConfig.configValidation('serviceManager.credentials', serviceManagerCreds, false,
          'Bind a Service Manager instance for separate object store mode')
        throw new Error("Service Manager Instance is not bound")
      }

      const { sm_url, url, clientid, clientsecret, certificate, key, certurl } = serviceManagerCreds

      // Validate required Service Manager fields
      const requiredSmFields = ['sm_url', 'url', 'clientid']
      const missingSmFields = requiredSmFields.filter(field => !serviceManagerCreds[field])

      if (missingSmFields.length > 0) {
        logConfig.configValidation('serviceManager.credentials', serviceManagerCreds, false,
          `Service Manager credentials missing: ${missingSmFields.join(', ')}`)
        throw new Error(`Missing Service Manager credentials: ${missingSmFields.join(', ')}`)
      }

      logConfig.debug('Fetching access token for tenant', { tenantID, sm_url })
      const token = await utils.fetchToken(url, clientid, clientsecret, certificate, key, certurl)

      logConfig.debug('Fetching object store credentials for tenant', { tenantID })
      const objectStoreCreds = await utils.getObjectStoreCredentials(tenantID, sm_url, token)

      if (!objectStoreCreds) {
        logConfig.withSuggestion('error',
          'Object store credentials not found for tenant', null,
          'Ensure Azure Blob Storage instance is subscribed and bound for this tenant',
          { tenantID })
        throw new Error(`Azure Blob Storage instance not bound for tenant ${tenantID}`)
      }

      // Validate object store credentials
      const requiredOsFields = ['container_name', 'container_uri', 'sas_token']
      const missingOsFields = requiredOsFields.filter(field => !objectStoreCreds.credentials?.[field])

      if (missingOsFields.length > 0) {
        logConfig.withSuggestion('error',
          'Object store credentials incomplete', null,
          'Check Azure Blob Storage instance configuration and binding',
          { tenantID, missingFields: missingOsFields })
        throw new Error(`Incomplete Azure Blob Storage credentials: ${missingOsFields.join(', ')}`)
      }

      logConfig.debug('Creating Azure Blob Storage client for tenant', {
        tenantID,
        containerName: objectStoreCreds.credentials.container_name
      })

      const creds = objectStoreCreds.credentials
      const blobServiceClient = new BlobServiceClient(creds.container_uri + "?" + creds.sas_token)
      const containerClient = blobServiceClient.getContainerClient(creds.container_name)

      azureClientsCache[tenantID] = {
        blobServiceClient,
        containerClient,
        containerName: creds.container_name,
      }

      this.blobServiceClient = azureClientsCache[tenantID].blobServiceClient
      this.containerClient = azureClientsCache[tenantID].containerClient
      this.containerName = azureClientsCache[tenantID].containerName

      logConfig.debug('Azure Blob Storage client has been created successful', {
        tenantID,
        containerName: this.containerName
      })

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

    try {
      // Check separate object store instances
      if (separateObjectStore) {
        const tenantID = req?.tenant
        if (!tenantID) {
          logConfig.withSuggestion('error',
            'Tenant ID required for separate object store mode', null,
            'Ensure request context includes tenant information',
            { separateObjectStore, hasTenant: !!tenantID })
          throw new Error('Tenant ID required for separate object store')
        }
        await this.createAzureClient(tenantID)
      }

      if (Array.isArray(data)) {
        logConfig.debug('Processing bulk file upload', {
          fileCount: data.length,
          filenames: data.map(d => d.filename)
        })
        return Promise.all(
          data.map((d) => this.put(attachments, d, isDraftEnabled, _content, req))
        )
      }

      let content = _content
      const { ...metadata } = data
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

      const blobClient = this.containerClient.getBlockBlobClient(blobName)

      logConfig.debug('Uploading file to Azure Blob Storage', {
        containerName: this.containerName,
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
        containerName: this.containerName,
        blobName,
        duration
      })

      // Initiate malware scan if configured
      if (this.kind === 'azure') {
        logConfig.debug('Initiating malware scan for uploaded file', {
          fileId: metadata.ID,
          filename: metadata.filename
        })

        const scanRequestJob = cds.spawn(async () => {
          await scanRequest(attachments, { ID: metadata.ID })
        })

        scanRequestJob.on('error', (err) => {
          logConfig.withSuggestion('error',
            'Failed to initiate malware scan for attachment', err,
            'Check malware scanner configuration and connectivity',
            { fileId: metadata.ID, filename: metadata.filename, errorMessage: err.message })
        })
      }

    } catch (err) {
      const duration = Date.now() - startTime
      logConfig.withSuggestion('error',
        'File upload to Azure Blob Storage failed', err,
        'Check Azure Blob Storage connectivity, credentials, and container permissions',
        { filename: data?.filename, fileId: data?.ID, containerName: this.containerName, blobName: data?.url, duration })
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

    try {
      // Check separate object store instances
      if (separateObjectStore) {
        if (!tenantID) {
          logConfig.withSuggestion('error',
            'Tenant ID required for separate object store mode', null,
            'Ensure request context includes tenant information',
            { separateObjectStore, hasTenant: !!tenantID })
          throw new Error('Tenant ID required for separate object store')
        }
        await this.createAzureClient(tenantID)
      }

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
        containerName: this.containerName,
        blobName
      })

      const blobClient = this.containerClient.getBlockBlobClient(blobName)
      const downloadResponse = await blobClient.download()

      const duration = Date.now() - startTime
      logConfig.debug('File streamed from Azure Blob Storage successfully', {
        fileId: keys.ID,
        containerName: this.containerName,
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
        { fileId: keys?.ID, containerName: this.containerName, attachmentName: attachments.name, duration })

      throw error
    }
  }

  /**
  * Deletes a file from Azure Blob Storage based on the provided key
  * @param {string} key - The key of the file to delete
  * @returns {Promise} - Promise resolving when deletion is complete
  */
  async deleteAttachment(key, req) {
    if (!key) return
    return await this.delete(key, req)
  }

  /**
   * Registers attachment handlers for the given service and entity
   * @param {*} records - The records to process
   * @param {import('@sap/cds').Request} req - The request object
   */
  async deleteAttachmentsWithKeys(records, req) {
    if (req?.attachmentsToDelete?.length > 0) {
      req.attachmentsToDelete.forEach((attachment) => {
        this.deleteAttachment(attachment.url, req)
      })
    }
  }

  /**
  * Registers attachment handlers for the given service and entity
  * @param {import('@sap/cds').Request} req - The request object
  */
  async attachDeletionData(req) {
    const attachments = cds.model.definitions[req?.target?.name + ".attachments"]
    if (attachments) {
      const diffData = await req.diff()
      let deletedAttachments = []
      diffData.attachments?.filter((object) => {
        return object._op === "delete"
      })
        .map((attachment) => {
          deletedAttachments.push(attachment.ID)
        })

      if (deletedAttachments.length > 0) {
        let attachmentsToDelete = await SELECT.from(attachments).columns("url").where({ ID: { in: [...deletedAttachments] } })
        if (attachmentsToDelete.length > 0) {
          req.attachmentsToDelete = attachmentsToDelete
        }
      }
    }
  }

  /**
   * Registers attachment handlers for the given service and entity
   * @param {import('@sap/cds').Request} req - The request object
   * @param {import('express').NextFunction} next - The next middleware function
   */
  async updateContentHandler(req, next) {
    logConfig.debug(`[Azure] Uploading file using updateContentHandler for ${req.target.name}`)
    // Check separate object store instances
    if (separateObjectStore) {
      const tenantID = cds.context.tenant
      await this.createAzureClient(tenantID)
    }

    const targetID = req.data.ID || req.params[1]?.ID || req.params[1];
    if (!targetID) {
      req.reject(400, "Missing ID in request");
    }

    if (req?.data?.content) {
      const response = await SELECT.from(req.target, { ID: targetID }).columns("url")
      if (response?.url) {
        const blobName = response.url
        const blobClient = this.containerClient.getBlockBlobClient(blobName)

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

        const keys = { ID: targetID }

        const scanRequestJob = cds.spawn(async () => {
          await scanRequest(req.target, keys)
        })

        scanRequestJob.on('error', async (err) => {
          logConfig.withSuggestion('error',
            'Failed to initiate malware scan for attachment', err,
            'Check malware scanner configuration and connectivity',
            { keys, errorMessage: err.message })
        })

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
   * Registers attachment handlers for the given service and entity
   * @param {{draftEntity: string, activeEntity:cds.Entity, id:string}} param0 - The service and entities
   * @returns 
   */
  async getAttachmentsToDelete({ draftEntity, activeEntity, id }) {
    const [draftAttachments, activeAttachments] = await Promise.all([
      SELECT.from(draftEntity).columns("url").where(id),
      SELECT.from(activeEntity).columns("url").where(id)
    ])

    const activeUrls = new Set(activeAttachments.map(a => a.url))
    return draftAttachments
      .filter(({ url }) => !activeUrls.has(url))
      .map(({ url }) => ({ url }))
  }

  /**
   * Add draft attachment deletion data to the request
   * @param {import('@sap/cds').Request} req - The request object
   */
  async attachDraftDeletionData(req) {
    const draftEntity = cds.model.definitions[req?.target?.name]
    const name = req?.target?.name
    const activeEntity = name ? cds.model.definitions?.[name.split(".").slice(0, -1).join(".")] : undefined

    if (!draftEntity || !activeEntity) return

    const diff = await req.diff()
    if (diff._op !== "delete" || !diff.ID) return

    const attachmentsToDelete = await this.getAttachmentsToDelete({
      draftEntity,
      activeEntity,
      id: { ID: diff.ID }
    })

    if (attachmentsToDelete.length) {
      req.attachmentsToDelete = attachmentsToDelete
    }
  }

  /**
   * Add draft discard deletion data to the request
   * @param {import('@sap/cds').Request} req - The request object
   */
  async attachDraftDiscardDeletionData(req) {
    const { ID } = req.data
    const parentEntity = req.target.name.split('.').slice(0, -1).join('.')
    const draftEntity = cds.model.definitions[`${parentEntity}.attachments.drafts`]
    const activeEntity = cds.model.definitions[`${parentEntity}.attachments`]

    if (!draftEntity || !activeEntity) return

    const attachmentsToDelete = await this.getAttachmentsToDelete({
      draftEntity,
      activeEntity,
      id: { up__ID: ID }
    })

    if (attachmentsToDelete.length) {
      req.attachmentsToDelete = attachmentsToDelete
    }
  }

  /**
   * @inheritdoc
   */
  registerUpdateHandlers(srv, entity, mediaElement) {
    srv.before(["DELETE", "UPDATE"], entity, this.attachDeletionData.bind(this))
    srv.after(["DELETE", "UPDATE"], entity, this.deleteAttachmentsWithKeys.bind(this))

    srv.prepend(() => {
      srv.on(
        "PUT",
        mediaElement,
        this.updateContentHandler.bind(this)
      )
    })
  }

  /**
   * @inheritdoc
   */
  registerDraftUpdateHandlers(srv, entity, mediaElement) {
    srv.before(["DELETE", "UPDATE"], entity, this.attachDeletionData.bind(this))
    srv.after(["DELETE", "UPDATE"], entity, this.deleteAttachmentsWithKeys.bind(this))

    // case: attachments uploaded in draft and draft is discarded
    srv.before("CANCEL", entity.drafts, this.attachDraftDiscardDeletionData.bind(this))
    srv.after("CANCEL", entity.drafts, this.deleteAttachmentsWithKeys.bind(this))

    srv.prepend(() => {
      if (mediaElement.drafts) {
        srv.on(
          "PUT",
          mediaElement.drafts,
          this.updateContentHandler.bind(this)
        )

        // case: attachments uploaded in draft and deleted before saving
        srv.before(
          "DELETE",
          mediaElement.drafts,
          this.attachDraftDeletionData.bind(this)
        )
        srv.after(
          "DELETE",
          mediaElement.drafts,
          this.deleteAttachmentsWithKeys.bind(this)
        )
      }
    })
  }

  /**
   * Deletes a file from Azure Blob Storage
   * @param {string} Key - The key of the file to delete
   * @returns {Promise} - Promise resolving when deletion is complete
   */
  async delete(blobName) {
    const tenantID = cds.context.tenant
    logConfig.debug(`[Azure] Executing delete for file ${blobName} in bucket ${this.containerName}`)

    // Check separate object store instances
    if (separateObjectStore) {
      await this.createAzureClient(tenantID)
    }

    const blobClient = this.containerClient.getBlockBlobClient(blobName)
    const response = await blobClient.delete()
    return response._response.status === 202
  }

  /**
   * @inheritdoc
   */
  async deleteInfectedAttachment(Attachments, key) {
    const response = await SELECT.from(Attachments, key).columns('url')
    return await this.delete(response.url)
  }
}
