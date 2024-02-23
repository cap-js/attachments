const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3')
const { Upload } = require("@aws-sdk/lib-storage");

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
    const input = {
      Bucket: this.bucket, Key,
      Body: content
    }
    try {
      const multipartUpload = new Upload({
          client: new S3Client({}),
          params: input,
      });
      const stored = super.put (Attachments, metadata)
      await Promise.all ([ stored, multipartUpload.done() ])
      // TODO: add malware scan
    } catch (err) {
      console.error(err);
    }
  }

  async get (Attachments, keys) {
    const Key = _key4 (Attachments, keys)
    const downloaded = await this.client.send (new GetObjectCommand({
      Bucket: this.bucket, Key,
    }))
    return downloaded.Body
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
