const { Readable } = require('stream')
const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsCommand } = require('@aws-sdk/client-s3')

const AttachmentsService = require('../common')

class AWSAttachmentsService extends AttachmentsService {

    init() {
        super.init()
        this.client = new S3Client({
            region: this.credentials.region,
            credentials: {
                accessKeyId: this.credentials.access_key_id,
                secretAccessKey: this.credentials.secret_access_key
            }
        })

    }

    async onGET(fileName) {
        const { bucket } = this.credentials
        const command = fileName ?
            new ListObjectsCommand({ Bucket: bucket, Prefix: fileName }) :
            new ListObjectsCommand({ Bucket: bucket })
        const res = await this.client.send(command)
        return res['Contents']
    }

    async onPUT(items) {
        const { bucket } = this.credentials
        for (const item of items) {
            const command = new PutObjectCommand({
                Bucket: bucket,
                Key: item.fileName,
                Body: item.content,
            })
            await this.client.send(command);
        }
    }

    async onSTREAM(fileName) {
        const command = new GetObjectCommand({
            Bucket: this.credentials.bucket,
            Key: fileName
        })
        const res = await this.client.send(command)
        return Readable.from(res.Body)
    }

}

module.exports = AWSAttachmentsService