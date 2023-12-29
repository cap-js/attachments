const cds = require('@sap/cds')
const DEBUG = cds.debug('attachments')
const { S3Client, GetObjectCommand, ListObjectsCommand } = require('@aws-sdk/client-s3')
const { Upload } = require("@aws-sdk/lib-storage")
const { Readable } = require('stream')

class AWSAttachmentsService extends require('./basic') {

  async init() {
    super.init()
    this.credentials = this.options.credentials
    this.client = new S3Client({
      region: this.credentials.region,
      credentials: {
        accessKeyId: this.credentials.access_key_id,
        secretAccessKey: this.credentials.secret_access_key
      }
    })
  }

  async list (ID) {
    const { bucket } = this.credentials
    const command = ID ?
      new ListObjectsCommand({ Bucket: bucket, Prefix: ID }) :
      new ListObjectsCommand({ Bucket: bucket })
    const res = await this.client.send(command)
    return res['Contents']
  }

  async upload (data) {
    const data_2_upload = []
    for (const data_item of data) {
      const { ID } = data_item
      const content_old = await this.list(ID)
      if (content_old === null) {
        data_2_upload.push(data_item)
      }
    }
    if (data.filename || data_2_upload.length > 0) {
      DEBUG?.('Uploading attachment for', data.filename || data_2_upload.map?.(d => d.filename))
    } else {
      DEBUG?.('No new attachments to upload')
    }
    if (Array.isArray(data_2_upload)) return Promise.all (data_2_upload.map (d => this.upload(d)))
    const { content, ...metadata } = data_2_upload
    const stored = super.upload (metadata)
    // REVISIT: This is not streaming, is it?
    const fileBuffer = new Buffer.from(content, 'base64')
    const stream = new Readable({
      read() {
        this.push(fileBuffer)
        this.push(null)
      }
    })
    const { ID } = metadata
    const parallelUpload = new Upload({
      client: this.client,
      params: {
        Bucket: this.credentials.bucket,
        Key: ID,
        Body: stream
      },
    })
    return await Promise.all ([ stored, parallelUpload.done()])
  }

  async download (ID) {
    const command = new GetObjectCommand({
      Bucket: this.credentials.bucket,
      Key: ID,
    })
    const res = await this.client.send(command)
    return res.Body
  }

}

module.exports = AWSAttachmentsService
