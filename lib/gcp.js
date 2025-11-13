const { Storage } = require('@google-cloud/storage')
const cds = require("@sap/cds")
const utils = require('./helper')
const { SELECT } = cds.ql
const { logConfig } = require('./logger')

const isMultiTenancyEnabled = !!cds.env.requires.multitenancy
const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind
const separateObjectStore = isMultiTenancyEnabled && objectStoreKind === "separate"

module.exports = class GoogleAttachmentsService extends require("./object-store") {

  clientsCache = new Map()

  /**
   * Initializes the Google Cloud Platform Attachments Service
   */
  init() {
    logConfig.info('Google Cloud Platform Attachments Service initialization', {
      multiTenancy: isMultiTenancyEnabled,
      objectStoreKind,
      separateObjectStore,
      attachmentsConfig: {
        kind: cds.env.requires?.attachments?.kind,
        scan: cds.env.requires?.attachments?.scan
      }
    })

    return super.init()
  }

  /**
   * 
   * @returns {Promise<import('@google-cloud/storage').Bucket>}
   */
  async getBucket() {
    const cacheKey = separateObjectStore ? cds.context.tenant : 'shared'
    const existingClient = this.clientsCache.get(cacheKey);
    if (existingClient) {
      return existingClient.bucket
    } else {
      return (await this.createGoogleClient(cacheKey)).bucket;
    }
  }

  /**
   * Creates or retrieves a cached Google Cloud Platform client for the given tenant
   * @param {String} tenantID - The tenant ID for which to create/retrieve the client
   * @returns {Promise<{bucket: import('@google-cloud/storage').Bucket}>}
   */
  async createGoogleClient(tenantID) {
    logConfig.info('Creating tenant-specific Google Cloud Platform client', { tenantID })
    const existingClient = this.clientsCache.get(tenantID);
    if (existingClient) {
      logConfig.debug('Using cached GCP client', {
        tenantID,
        bucketName: existingClient.bucket.name
      })
      return existingClient;
    }

    try {
      logConfig.debug(`Fetching object store credentials for tenant ${tenantID}. Using ${separateObjectStore ? 'shared' : 'tenant-specific'} object store.`)
      const credentials = separateObjectStore 
        ? (await utils.getObjectStoreCredentials(tenantID))?.credentials
        : cds.env.requires?.objectStore?.credentials

      if (!credentials) {
        if (Object.keys(credentials).includes('access_key_id')) {
          throw new Error('AWS S3 credentials found where Google Cloud Platform credentials expected, please check your service bindings.')
        } else if (Object.keys(credentials).includes('container_name')) {
          throw new Error('Azure credentials found where Google Cloud Platform credentials expected, please check your service bindings.')
        }
        throw new Error("SAP Object Store instance is not bound.")
      }

      // Validate required credentials
      const requiredFields = ['bucket', 'projectId', 'base64EncodedPrivateKeyData']
      const missingFields = requiredFields.filter(field => !credentials[field])

      if (missingFields.length > 0) {
        logConfig.configValidation('objectStore.credentials', credentials, false,
          `Google Cloud Platform credentials missing: ${missingFields.join(', ')}`)
        throw new Error(`Missing Google Cloud Platform credentials: ${missingFields.join(', ')}`)
      }

      logConfig.debug('Creating Google Cloud Platform client for tenant', {
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

      logConfig.debug('Google Cloud Platform client has been created successful', {
        tenantID,
        bucketName: newGoogleClient.bucket.name
      })

      return newGoogleClient

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

    const bucket = await this.getBucket()

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

      const file = bucket.file(blobName)

      logConfig.debug('Uploading file to Google Cloud Platform', {
        bucketName: bucket.name,
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
        bucketName: bucket.name,
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
        { filename: data?.filename, fileId: data?.ID, bucketName: bucket.name, blobName: data?.url, duration })
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
    const bucket = await this.getBucket();

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

      logConfig.debug('Streaming file from Google Cloud Platform', {
        bucketName: bucket.name,
        blobName
      })

      const file = bucket.file(blobName)
      const readStream = file.createReadStream()

      const duration = Date.now() - startTime
      logConfig.debug('File streamed from Google Cloud Platform successfully', {
        fileId: keys.ID,
        bucketName: bucket.name,
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
        { fileId: keys?.ID, bucketName: bucket.name, attachmentName: attachments.name, duration })

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
    const targetID = req.data.ID || req.params[1]?.ID || req.params[1]
    if (!targetID) {
      req.reject(400, "Missing ID in request")
    }

    if (req?.data?.content) {
      const response = await SELECT.from(req.target, { ID: targetID }).columns("url")
      if (response?.url) {
        const bucket = await this.getBucket();
        const blobName = response.url
        const file = bucket.file(blobName)

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
   * Deletes a file from Google Cloud Platform
   * @param {string} Key - The key of the file to delete
   * @returns {Promise} - Promise resolving when deletion is complete
   */
  async delete(blobName) {
    const bucket = await this.getBucket()
    logConfig.debug(`[GCP] Executing delete for file ${blobName} in bucket ${bucket.name}`)

    const file = bucket.file(blobName)
    const response = await file.delete()
    return response._response.status === 202 //TODO: double check this
  }
}
