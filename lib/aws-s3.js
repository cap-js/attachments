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
    if (ID) {
      const { filename } = await SELECT `filename` .from ('sap.common.Attachments',ID)
      var ext = filename.split('.').pop()
    }
    const { bucket } = this.credentials
    // TODO: Detect file extension automatically
    const command = ID ?
      new ListObjectsCommand({ Bucket: bucket, Prefix: `${ID}.${ext}` }) :
      new ListObjectsCommand({ Bucket: bucket })
    const res = await this.client.send(command)
    return res['Contents']
  }

  async upload (data) {
    if (Array.isArray(data)) return Promise.all (data.map (d => this.upload(d)))
    const { content, ...metadata } = data
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
