const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const { Upload } = require("@aws-sdk/lib-storage")
const cds = require("@sap/cds")
const utils = require('./helper.js')
const { logConfig } = require('./logger')

const isMultiTenancyEnabled = !!cds.env.requires.multitenancy
const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind
const separateObjectStore = isMultiTenancyEnabled && objectStoreKind === "separate"

module.exports = class AWSAttachmentsService extends require("./basic") {

  clientsCache = new Map()

  /**
   * Initializes the AWS S3 Attachments Service
   */
  init() {
    logConfig.info('AWS S3 Attachments Service initialization', {
      multiTenancy: isMultiTenancyEnabled,
      objectStoreKind,
      separateObjectStore,
      attachmentsConfig: {
        kind: cds.env.requires?.attachments?.kind,
        scan: cds.env.requires?.attachments?.scan
      }
    })

    this.on('DeleteAttachment', async msg => {
      await this.delete(msg.data.url)
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
   * @returns {Promise<import('@aws-sdk/client-s3').S3Client>}
   */
  async getClient() {
    const cacheKey = separateObjectStore ? cds.context.tenant : 'shared'
    const existingClient = this.clientsCache.get(cacheKey);
    if (existingClient) {
      return existingClient.client
    } else {
      return (await this.createClientS3(cacheKey)).client;
    }
  }

  /**
   * 
   * @returns {Promise<string>} Bucket
   */
  async getBucket() {
    const cacheKey = separateObjectStore ? cds.context.tenant : 'shared'
    const existingClient = this.clientsCache.get(cacheKey);
    if (existingClient) {
      return existingClient.bucket
    } else {
      return (await this.createClientS3(cacheKey)).bucket;
    }
  }

  /**
   * Creates or retrieves a cached S3 client for the specified tenant
   * @param {String} tenantID - The tenant ID for which to create/retrieve the S3 client
   * @returns {Promise<{client: import('@aws-sdk/client-s3').S3Client, bucket: string}>}
   */
  async createClientS3(tenantID) {
    logConfig.info('Creating S3 client for', { tenantID })
    const existingClient = this.clientsCache.get(tenantID);
    if (existingClient) {
      logConfig.debug('Using cached S3 client', {
        tenantID,
        bucket: existingClient.bucket
      })
      return existingClient;
    }

    try {
      logConfig.debug(`Fetching object store credentials for tenant ${tenantID}. Using ${separateObjectStore ? 'shared' : 'tenant-specific'} object store.`)
      const credentials = separateObjectStore 
        ? (await utils.getObjectStoreCredentials(tenantID))?.credentials
        : cds.env.requires?.objectStore?.credentials
      
      // Validate object store credentials
      if (!credentials) {
        if (Object.keys(credentials).includes('container_name')) {
          throw new Error('Azure Blob Storage found where AWS S3 credentials expected, please check your service bindings.')
        } else if (Object.keys(credentials).includes('projectId')) {
          throw new Error('Google Cloud Platform credentials found where AWS S3 credentials expected, please check your service bindings.')
        }
        throw new Error("SAP Object Store instance is not bound.")
      }

      // Validate required credentials
      const requiredFields = ['bucket', 'region', 'access_key_id', 'secret_access_key']
      const missingFields = requiredFields.filter(field => !credentials[field])

      if (missingFields.length > 0) {
        if (Object.keys(credentials).includes('container_name')) {
          throw new Error('Azure Blob Storage found where AWS S3 credentials expected, please check your service bindings.')
        } else if (Object.keys(credentials).includes('projectId')) {
          throw new Error('Google Cloud Platform credentials found where AWS S3 credentials expected, please check your service bindings.')
        }
        throw new Error(`Missing Object Store credentials: ${missingFields.join(', ')}`)
      }

      logConfig.debug('Creating S3 client', {
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

      logConfig.debug('s3 client has been created successfully', {
        tenantID,
        bucket: newS3Client.bucket,
        region: credentials.region
      })
      return newS3Client;
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

    const bucket = await this.getBucket();
    const client = await this.getClient();

    try {
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
        Bucket: bucket,
        Key,
        Body: content,
      }

      logConfig.debug('Uploading file to S3', {
        bucket: bucket,
        key: Key,
        filename: metadata.filename,
        contentSize: content.length || content.size || 'unknown'
      })

      const multipartUpload = new Upload({
        client: client,
        params: input,
      })

      const stored = super.put(attachments, metadata, null, isDraftEnabled)

      await Promise.all([stored, multipartUpload.done()])

      const hash = await utils.computeHash(await this.get(attachments, { ID: metadata.ID }))
      await super.update(attachments, { ID: metadata.ID }, { hash })

      const duration = Date.now() - startTime
      logConfig.debug('File upload to S3 completed successfully', {
        filename: metadata.filename,
        fileId: metadata.ID,
        bucket: bucket,
        key: Key,
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

    const tenantID = cds.context.tenant

    logConfig.processStep('Starting file download from S3', {
      attachmentEntity: attachments.name,
      keys,
      tenant: tenantID
    })

    const bucket = await this.getBucket();
    const client = await this.getClient();

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

      const Key = response.url

      logConfig.debug('Streaming file from S3', {
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
      logConfig.debug('File streamed from S3 successfully', {
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

      logConfig.withSuggestion('error',
        'File download from S3 failed', error,
        suggestion,
        { fileId: keys?.ID, bucket: bucket, attachmentName: attachments.name, duration })

      throw error
    }
  }

  /**
   * Registers attachment handlers for the given service and entity
   * @param {import('@sap/cds').Request} req - The request object
   * @param {import('express').NextFunction} next - The next middleware function
   */
  async updateContentHandler(req, next) {
    logConfig.debug(`[AWS S3] Uploading file using updateContentHandler for ${req.target.name}`)

    const targetID = req.data.ID || req.params[1]?.ID || req.params[1]
    if (!targetID) {
      req.reject(400, "Missing ID in request")
    }

    if (req?.data?.content) {
      const response = await SELECT.from(req.target, { ID: targetID }).columns("url")
      if (response?.url) {
        const bucket = await this.getBucket();
        const client = await this.getClient();

        const multipartUpload = new Upload({
          client: client,
          params: {
            Bucket: bucket,
            Key: response.url,
            Body: req.data.content,
          },
        })
        await multipartUpload.done()

        const hash = await utils.computeHash(await this.get(req.target, { ID: targetID }))
        await super.update(req.target, { ID: targetID }, { hash })

        const MalwareScanner = await cds.connect.to('malwareScanner')
        await MalwareScanner.emit('ScanFile', { target: req.target.name, keys: { ID: targetID } })

        logConfig.debug(`[AWS S3] Uploaded file using updateContentHandler for ${req.target.name}`)
      }
    } else if (req?.data?.note) {
      const key = { ID: targetID }
      await super.update(req.target, key, { note: req.data.note })
      logConfig.debug(`[AWS S3] Updated file upload with note for ${req.target.name}`)
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
   * Deletes a file from S3 based on the provided key
   * @param {string} Key - The key of the file to delete
   * @returns {Promise} - Promise resolving when deletion is complete
   */
  async delete(Key) {
    const bucket = await this.getBucket();
    const client = await this.getClient();
    logConfig.debug(`[AWS S3] Executing delete for file ${Key} in bucket ${bucket}`)

    const response = await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key,
      })
    )
    return response.DeleteMarker
  }
}
