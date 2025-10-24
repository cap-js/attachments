const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const { Upload } = require("@aws-sdk/lib-storage")
const cds = require("@sap/cds")
const utils = require('./helper.js')
const { SELECT } = cds.ql
const { logConfig } = require('./logger')

const isMultitenacyEnabled = !!cds.env.requires.multitenancy
const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind
const separateObjectStore = isMultitenacyEnabled && objectStoreKind === "separate"

const s3ClientsCache = {}
module.exports = class AWSAttachmentsService extends require("./basic") {
  /**
   * Initializes the AWS S3 Attachments Service
   */
  init() {
    // Log initial configuration
    logConfig.info('AWS S3 Attachments Service initialization', {
      multitenancy: isMultitenacyEnabled,
      objectStoreKind,
      separateObjectStore,
      attachmentsConfig: {
        kind: cds.env.requires?.attachments?.kind,
        scan: cds.env.requires?.attachments?.scan
      }
    })

    logConfig.processStep('Initializing AWS S3 Attachments Service', {
      separateObjectStore
    })

    // For single tenant or shared object store instance
    if (!separateObjectStore) {
      const creds = cds.env.requires?.objectStore?.credentials

      if (!creds) {
        logConfig.configValidation('objectStore.credentials', creds, false,
          'Bind an SAP Object Store instance to your application or configure separateObjectStore for multitenancy')
        throw new Error("SAP Object Store instance is not bound.")
      }

      // Validate required credentials
      const requiredFields = ['bucket', 'region', 'access_key_id', 'secret_access_key']
      const missingFields = requiredFields.filter(field => !creds[field])

      if (missingFields.length > 0) {
        logConfig.configValidation('objectStore.credentials', creds, false,
          `Object Store credentials missing: ${missingFields.join(', ')}`)
        throw new Error(`Missing Object Store credentials: ${missingFields.join(', ')}`)
      }

      logConfig.info('Configuring shared S3 client', {
        bucket: creds.bucket,
        region: creds.region,
        hasAccessKey: !!creds.access_key_id,
        hasSecretKey: !!creds.secret_access_key
      })

      this.bucket = creds.bucket
      this.client = new S3Client({
        region: creds.region,
        credentials: {
          accessKeyId: creds.access_key_id,
          secretAccessKey: creds.secret_access_key,
        },
      })

      logConfig.info('AWS S3 client initialized successfully', {
        bucket: this.bucket,
        region: creds.region
      })

      return super.init()
    } else {
      logConfig.info('Separate object store mode enabled - clients will be created per tenant')
    }

    this.on('DeleteAttachment', async msg => {
      await this.delete(msg.data.url);
    });

    this.on('DeleteInfectedAttachment', async msg => {
      const {target, hash, keys} = msg.data;
      const attachment = await SELECT.one.from(target).where(Object.assign({hash}, keys)).columns('url');
      if (attachment) { //Might happen that a draft object is the target
        await this.delete(attachment.url);
      } else {
        logConfig.warn(`Cannot delete malware file with the hash ${hash} for attachment ${target}, keys: ${keys}`);
      }
    });
  }

  /**
   * Creates or retrieves a cached S3 client for the specified tenant
   * @param {String} tenantID - The tenant ID for which to create/retrieve the S3 client
   */
  async createClientS3(tenantID) {
    logConfig.processStep('Creating tenant-specific S3 client', { tenantID })

    try {
      // Check cache first
      if (s3ClientsCache[tenantID]) {
        logConfig.debug('Using cached S3 client', {
          tenantID,
          bucket: s3ClientsCache[tenantID].bucket
        })
        this.client = s3ClientsCache[tenantID].client
        this.bucket = s3ClientsCache[tenantID].bucket
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
          'Ensure Object Store instance is subscribed and bound for this tenant',
          { tenantID })
        throw new Error(`SAP Object Store instance not bound for tenant ${tenantID}`)
      }

      // Validate object store credentials
      const requiredOsFields = ['region', 'access_key_id', 'secret_access_key', 'bucket']
      const missingOsFields = requiredOsFields.filter(field => !objectStoreCreds.credentials?.[field])

      if (missingOsFields.length > 0) {
        logConfig.withSuggestion('error',
          'Object store credentials incomplete', null,
          'Check Object Store instance configuration and binding',
          { tenantID, missingFields: missingOsFields })
        throw new Error(`Incomplete Object Store credentials: ${missingOsFields.join(', ')}`)
      }

      logConfig.debug('Creating S3 client for tenant', {
        tenantID,
        region: objectStoreCreds.credentials.region,
        bucket: objectStoreCreds.credentials.bucket
      })

      const s3Client = new S3Client({
        region: objectStoreCreds.credentials.region,
        credentials: {
          accessKeyId: objectStoreCreds.credentials.access_key_id,
          secretAccessKey: objectStoreCreds.credentials.secret_access_key,
        },
      })

      s3ClientsCache[tenantID] = {
        client: s3Client,
        bucket: objectStoreCreds.credentials.bucket,
      }

      this.client = s3ClientsCache[tenantID].client
      this.bucket = s3ClientsCache[tenantID].bucket

      logConfig.debug('s3 client has been created successful', {
        tenantID,
        bucket: this.bucket,
        region: objectStoreCreds.credentials.region
      })

    } catch (error) {
      logConfig.withSuggestion('error',
        'Failed to create tenant-specific S3 client', error,
        'Check Service Manager and Object Store instance configuration',
        { tenantID })
      throw error
    }
  }

  /**
   * @inheritdoc
   */
  async put(attachments, data, _content, isDraftEnabled) {
    const startTime = Date.now()

    const tenantID = cds.context.tenant

    logConfig.processStep('Starting file upload to S3', {
      attachmentEntity: attachments.name,
      isDraftEnabled,
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
        await this.createClientS3(tenantID)
      }

      if (Array.isArray(data)) {
        logConfig.debug('Processing bulk file upload', {
          fileCount: data.length,
          filenames: data.map(d => d.filename)
        })
        return Promise.all(
          data.map((d) => this.put(attachments, d, _content, isDraftEnabled))
        )
      }

      const { content = _content, ...metadata } = data
      const Key = metadata.url

      if (!Key) {
        logConfig.withSuggestion('error',
          'File key/URL is required for S3 upload', null,
          'Ensure attachment data includes a valid URL/key',
          { metadata: { ...metadata, content: !!content } })
        return
      }

      if (!content) {
        logConfig.withSuggestion('error',
          'File content is required for S3 upload', null,
          'Ensure attachment data includes file content',
          { key: Key, hasContent: !!content })
        return
      }

      const input = {
        Bucket: this.bucket,
        Key,
        Body: content,
      }

      logConfig.debug('Uploading file to S3', {
        bucket: this.bucket,
        key: Key,
        filename: metadata.filename,
        contentSize: content.length || content.size || 'unknown'
      })

      const multipartUpload = new Upload({
        client: this.client,
        params: input,
      })

      metadata.hash = await utils.computeHash(content);
      const stored = super.put(attachments, metadata, null, isDraftEnabled)

      await Promise.all([stored, multipartUpload.done()])

      const duration = Date.now() - startTime
      logConfig.debug('File upload to S3 completed successfully', {
        filename: metadata.filename,
        fileId: metadata.ID,
        bucket: this.bucket,
        key: Key,
        duration
      })

      // Initiate malware scan if configured
      if (this.kind === 's3') {
        logConfig.debug('Initiating malware scan for uploaded file', {
          fileId: metadata.ID,
          filename: metadata.filename
        })
        const MalwareScanner = await cds.connect.to('malwareScanner');
        await MalwareScanner.emit('ScanFile', {target: attachments.name, keys: { ID: metadata.ID }});
      }

    } catch (err) {
      const duration = Date.now() - startTime
      logConfig.withSuggestion('error',
        'File upload to S3 failed', err,
        'Check S3 connectivity, credentials, and bucket permissions',
        { filename: data?.filename, fileId: data?.ID, bucket: this.bucket, key: data?.url, duration })
      throw err
    }
  }

  /**
   * @inheritdoc
   */
  async get(attachments, keys) {
    const startTime = Date.now()

    const tenantID = cds.context.tenant

    logConfig.processStep('Starting file download from S3', {
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
        await this.createClientS3(tenantID)
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

      const Key = response.url

      logConfig.debug('Streaming file from S3', {
        bucket: this.bucket,
        key: Key
      })

      const content = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key,
        })
      )

      const duration = Date.now() - startTime
      logConfig.debug('File streamed from S3 successfully', {
        fileId: keys.ID,
        bucket: this.bucket,
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

      logConfig.withSuggestion('error',
        'File download from S3 failed', error,
        suggestion,
        { fileId: keys?.ID, bucket: this.bucket, attachmentName: attachments.name, duration })

      throw error
    }
  }

  /**
   * Registers attachment handlers for the given service and entity
   * @param {import('@sap/cds').Request} req - The request object
   * @param {import('express').NextFunction} next - The next middleware function
   */
  async updateContentHandler(req, next) {
    logConfig.debug(`[S3 Upload] Uploading file using updateContentHandler for ${req.target.name}`)

    // Check separate object store instances
    if (separateObjectStore) {
      const tenantID = cds.context.tenant
      await this.createClientS3(tenantID)
    }

    const targetID = req.data.ID || req.params[1]?.ID || req.params[1];
    if (!targetID) {
      req.reject(400, "Missing ID in request");
    }

    if (req?.data?.content) {
      const response = await SELECT.from(req.target, { ID: targetID }).columns("url");
      if (response?.url) {
        const Key = response.url
        const input = {
          Bucket: this.bucket,
          Key,
          Body: req.data.content,
        }
        const multipartUpload = new Upload({
          client: this.client,
          params: input,
        })
        await multipartUpload.done()

        const keys = { ID: targetID }

        const MalwareScanner = await cds.connect.to('malwareScanner');
        await MalwareScanner.emit('ScanFile', {target: req.target.name, keys});

        logConfig.debug(`[S3 Upload] Uploaded file using updateContentHandler for ${req.target.name}`)
      }
    } else if (req?.data?.note) {
      const key = { ID: targetID }
      await super.update(req.target, key, { note: req.data.note })
      logConfig.debug(`[S3 Upload] Updated file upload with note for ${req.target.name}`)
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
   * Deletes a file from S3 based on the provided key
   * @param {string} Key - The key of the file to delete
   * @returns {Promise} - Promise resolving when deletion is complete
   */
  async delete(Key) {
    const tenantID = cds.context.tenant
    logConfig.debug(`[S3 Upload] Executing delete for file ${Key} in bucket ${this.bucket}`)

    // Check separate object store instances
    if (separateObjectStore) {
      await this.createClientS3(tenantID)
    }

    const response = await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key,
      })
    )
    return response.DeleteMarker
  }
}
