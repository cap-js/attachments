const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsCommand } = require('@aws-sdk/client-s3')

module.exports = class AWSAttachmentsService extends require('./basic') {

  init() {
    const creds = this.options.credentials
    this.bucket = creds.bucket
    this.client = new S3Client({
      region: creds.region,
      credentials: {
        accessKeyId: creds.access_key_id,
        secretAccessKey: creds.secret_access_key
      }
    })
    return super.init()
  }

  async put (Attachments, data, _content) {
    if (Array.isArray(data)) return Promise.all (data.map (d => this.put(Attachments,d)))
    const { content = _content, ...metadata } = data
    const Key = _key4 (Attachments, metadata)
    const uploaded = this.client.send (new PutObjectCommand({
      Bucket: this.bucket, Key,
      Body: content
    }))
    // TODO: add malware scan
    const stored = super.put (Attachments, metadata)
    await Promise.all ([ stored, uploaded ])
  }

  async get (Attachments, keys) {
    const Key = _key4 (Attachments, keys)
    const downloaded = await this.client.send (new GetObjectCommand({
      Bucket: this.bucket, Key,
    }))
    return downloaded.Body
  }

  async list (prefix) {
    const list = await this.client.send (new ListObjectsCommand({
      Bucket: this.bucket, Prefix: prefix
    }))
    return list;
  }

  async delete (Key) {
      const response = await this.client.send (new DeleteObjectCommand({
        Bucket: this.bucket, Key,
      }))
      return response.DeleteMarker;
  }
}


const $keys = Symbol()
const _key4 = (Attachments,data) => {
  let keys = Attachments[$keys]; if (!keys) {
    let { up_ } = Attachments.keys
    if (up_) keys = up_.keys.map(k => 'up__'+k.ref[0]).concat('filename')
    else keys = Object.keys(Attachments.keys) //> for Images
    Attachments[$keys] = keys
  }
  const key = keys.map(k => data[k]).join('/')
  return key
}
