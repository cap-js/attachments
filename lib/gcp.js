const { Storage } = require('@google-cloud/storage')
const cds = require("@sap/cds")
const utils = require('./helper')
const { SELECT } = cds.ql
const { logConfig } = require('./logger')

const isMultitenacyEnabled = !!cds.env.requires.multitenancy
const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind
const separateObjectStore = isMultitenacyEnabled && objectStoreKind === "separate"

const googleClientsCache = {}
module.exports = class GoogleAttachmentsService extends require("./basic") {
  /**
   * Initializes the Google Cloud Platform Attachments Service
   */
  init() {
    // Log initial configuration
    logConfig.info('Google Cloud Platform Attachments Service initialization', {
      multitenancy: isMultitenacyEnabled,
      objectStoreKind,
      separateObjectStore,
      attachmentsConfig: {
        kind: cds.env.requires?.attachments?.kind,
        scan: cds.env.requires?.attachments?.scan
      }
    })

    logConfig.processStep('Initializing Google Cloud Platform Attachments Service', {
      separateObjectStore
    })

    // For single tenant or shared object store instance
    if (!separateObjectStore) {
      const creds = cds.env.requires?.objectStore?.credentials

      if (!creds) {
        if (Object.keys(creds).includes('access_key_id')) {
          throw new Error('AWS S3 credentials found where Google Cloud Platform credentials expected, please check your service bindings.')
        } else if (Object.keys(creds).includes('container_name')) {
          throw new Error('Azure credentials found where Google Cloud Platform credentials expected, please check your service bindings.')
        }
        throw new Error("SAP Object Store instance is not bound.")
      }

      // Validate required credentials
      const requiredFields = ['bucket', 'projectId', 'base64EncodedPrivateKeyData']
      const missingFields = requiredFields.filter(field => !creds[field])

      if (missingFields.length > 0) {
        logConfig.configValidation('objectStore.credentials', creds, false,
          `Google Cloud Platform credentials missing: ${missingFields.join(', ')}`)
        throw new Error(`Missing Google Cloud Platform credentials: ${missingFields.join(', ')}`)
      }

      logConfig.info('Configuring shared Google Cloud Platform client', {
        bucketName: creds.bucket,
        projectId: creds.projectId,
        hasServiceAccount: !!creds.base64EncodedPrivateKeyData
      })

      this.bucketName = creds.bucket
      this.storageClient = new Storage({
        projectId: creds.projectId,
        credentials: JSON.parse(Buffer.from(creds.base64EncodedPrivateKeyData, 'base64').toString('utf8')) // or path to key file
      })
      this.bucket = this.storageClient.bucket(creds.bucket)

      logConfig.info('Google Cloud Platform client initialized successfully', {
        bucketName: this.bucketName
      })

      return super.init()
    } else {
      logConfig.info('Separate object store mode enabled - clients will be created per tenant')
    }

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
  }

  /**
   * Creates or retrieves a cached Google Cloud Platform client for the given tenant
   * @param {String} tenantID - The tenant ID for which to create/retrieve the client
   */
  async createGoogleClient(tenantID) {
    logConfig.processStep('Creating tenant-specific Google Cloud Platform client', { tenantID })

    try {
      // Check cache first
      if (googleClientsCache[tenantID]) {
        logConfig.debug('Using cached Google Cloud Platform client', {
          tenantID,
          bucketName: googleClientsCache[tenantID].bucketName
        })
        this.storageClient = googleClientsCache[tenantID].storageClient
        this.bucket = googleClientsCache[tenantID].bucket
        this.bucketName = googleClientsCache[tenantID].bucketName
        return
      }

      logConfig.debug('Fetching object store credentials for tenant', { tenantID })
      const objectStoreCreds = await utils.getObjectStoreCredentials(tenantID)

      if (!objectStoreCreds) {
        logConfig.withSuggestion('error',
          'Object store credentials not found for tenant', null,
          'Ensure Google Cloud Platform instance is subscribed and bound for this tenant',
          { tenantID })
        throw new Error(`Google Cloud Platform instance not bound for tenant ${tenantID}`)
      }

      // Validate object store credentials
      const requiredOsFields = ['bucket', 'projectId', 'base64EncodedPrivateKeyData']
      const missingOsFields = requiredOsFields.filter(field => !objectStoreCreds.credentials?.[field])

      if (missingOsFields.length > 0) {
        logConfig.withSuggestion('error',
          'Object store credentials incomplete', null,
          'Check Google Cloud Platform instance configuration and binding',
          { tenantID, missingFields: missingOsFields })
        throw new Error(`Incomplete Google Cloud Platform credentials: ${missingOsFields.join(', ')}`)
      }

      logConfig.debug('Creating Google Cloud Platform client for tenant', {
        tenantID,
        bucketName: objectStoreCreds.credentials.bucket
      })

      const creds = objectStoreCreds.credentials
      const storageClient = new Storage({
        projectId: creds.projectId,
        credentials: JSON.parse(Buffer.from(creds.base64EncodedPrivateKeyData, 'base64').toString('utf8'))
      })
      const bucket = storageClient.bucket(creds.bucket)

      googleClientsCache[tenantID] = {
        storageClient,
        bucket,
        bucketName: creds.bucket,
      }

      this.storageClient = googleClientsCache[tenantID].storageClient
      this.bucket = googleClientsCache[tenantID].bucket
      this.bucketName = googleClientsCache[tenantID].bucketName

      logConfig.debug('Google Cloud Platform client has been created successful', {
        tenantID,
        bucketName: this.bucketName
      })

    } catch (error) {
      logConfig.withSuggestion('error',
        'Failed to create tenant-specific Google Cloud Platform client', error,
        'Check Service Manager and Google Cloud Platform instance configuration',
        { tenantID })
      throw error
    }
  }

  /**
  * @inheritdoc
  */
  async put(attachments, data, isDraftEnabled, _content, req) {
    const startTime = Date.now()

    logConfig.processStep('Starting file upload to Google Cloud Platform', {
      attachmentEntity: attachments.name,
      isDraftEnabled,
      tenant: req?.tenant
    })

    try {
      // Check separate object store instances
      if (separateObjectStore) {
        const tenantID = cds.context.tenant
        if (!tenantID) {
          logConfig.withSuggestion('error',
            'Tenant ID required for separate object store mode', null,
            'Ensure request context includes tenant information',
            { separateObjectStore, hasTenant: !!tenantID })
          throw new Error('Tenant ID required for separate object store')
        }
        await this.createGoogleClient(tenantID)
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

      const { content = _content, ...metadata } = data
      const blobName = metadata.url

      if (!blobName) {
        logConfig.withSuggestion('error',
          'File key/URL is required for Google Cloud Platform upload', null,
          'Ensure attachment data includes a valid URL/key',
          { metadata: { ...metadata, content: !!content } })
        throw new Error('File key is required for upload')
      }

      if (!content) {
        logConfig.withSuggestion('error',
          'File content is required for Google Cloud Platform upload', null,
          'Ensure attachment data includes file content',
          { key: blobName, hasContent: !!content })
        throw new Error('File content is required for upload')
      }

      const file = this.bucket.file(blobName)

      logConfig.debug('Uploading file to Google Cloud Platform', {
        bucketName: this.bucketName,
        blobName,
        filename: metadata.filename,
        contentSize: content.length || content.size || 'unknown'
      })

      const stored = super.put(attachments, metadata, null, isDraftEnabled)
      await Promise.all([stored, file.save(content)])

      const duration = Date.now() - startTime
      logConfig.debug('File upload to Google Cloud Platform completed successfully', {
        filename: metadata.filename,
        fileId: metadata.ID,
        bucketName: this.bucketName,
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
        'File upload to Google Cloud Platform failed', err,
        'Check Google Cloud Platform connectivity, credentials, and container permissions',
        { filename: data?.filename, fileId: data?.ID, bucketName: this.bucketName, blobName: data?.url, duration })
      throw err
    }
  }

  /**
  * @inheritdoc
  */
  async get(attachments, keys) {
    const startTime = Date.now()

    const tenantID = cds.context.tenant

    logConfig.processStep('Starting stream from Google Cloud Platform', {
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
        await this.createGoogleClient(tenantID)
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

      logConfig.debug('Streaming file from Google Cloud Platform', {
        bucketName: this.bucketName,
        blobName
      })

      const file = this.bucket.file(blobName)
      const readStream = file.createReadStream()

      const duration = Date.now() - startTime
      logConfig.debug('File streamed from Google Cloud Platform successfully', {
        fileId: keys.ID,
        bucketName: this.bucketName,
        blobName,
        duration
      })

      return readStream

    } catch (error) {
      const duration = Date.now() - startTime
      const suggestion = error.code === 'BlobNotFound' ?
        'File may have been deleted from Google Cloud Platform or URL is incorrect' :
        error.code === 'AuthenticationFailed' ?
          'Check Google Cloud Platform credentials and SAS token' :
          'Check Google Cloud Platform connectivity and configuration'

      logConfig.withSuggestion('error',
        'File download from Google Cloud Platform failed', error,
        suggestion,
        { fileId: keys?.ID, bucketName: this.bucketName, attachmentName: attachments.name, duration })

      throw error
    }
  }

  /**
   * Registers attachment handlers for the given service and entity
   * @param {import('@sap/cds').Request} req - The request object
   * @param {import('express').NextFunction} next - The next middleware function
   */
  async updateContentHandler(req, next) {
    logConfig.debug(`[GCP] Uploading file using updateContentHandler for ${req.target.name}`)
    // Check separate object store instances
    if (separateObjectStore) {
      const tenantID = cds.context.tenant
      await this.createGoogleClient(tenantID)
    }

    const targetID = req.data.ID || req.params[1]?.ID || req.params[1]
    if (!targetID) {
      req.reject(400, "Missing ID in request")
    }

    if (req?.data?.content) {
      const response = await SELECT.from(req.target, { ID: targetID }).columns("url")
      if (response?.url) {
        const blobName = response.url
        const file = this.bucket.file(blobName)

        await file.save(req.data.content)

        const hash = await utils.computeHash(await this.get(req.target, { ID: targetID }))
        await super.update(req.target, { ID: targetID }, { hash })

        const MalwareScanner = await cds.connect.to('malwareScanner')
        await MalwareScanner.emit('ScanFile', { target: req.target.name, keys: { ID: targetID } })

        logConfig.debug(`[GCP] Uploaded file using updateContentHandler for ${req.target.name}`)
      }
    } else if (req?.data?.note) {
      const key = { ID: targetID }
      await super.update(req.target, key, { note: req.data.note })
      logConfig.debug(`[GCP] Updated file upload with note for ${req.target.name}`)
    } else {
      next()
    }
  }

  /**
   * @inheritdoc
   */
  registerUpdateHandlers(srv, mediaElements) {
    for (const mediaElement of mediaElements) {
      srv.prepend(() => {
        srv.on(
          "PUT",
          mediaElement,
          this.updateContentHandler.bind(this)
        )
      })
    }
  }

  /**
   * @inheritdoc
   */
  registerDraftUpdateHandlers(srv, entity, mediaElements) {
    for (const mediaElement of mediaElements) {
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
  }

  /**
   * Deletes a file from Google Cloud Platform
   * @param {string} Key - The key of the file to delete
   * @returns {Promise} - Promise resolving when deletion is complete
   */
  async delete(blobName) {
    const tenantID = cds.context.tenant
    logConfig.debug(`[GCP] Executing delete for file ${blobName} in bucket ${this.bucketName}`)

    // Check separate object store instances
    if (separateObjectStore) {
      await this.createGoogleClient(tenantID)
    }

    const file = this.bucket.file(blobName)
    const response = await file.delete()
    return response._response.status === 202 //TODO: double check this
  }
}
