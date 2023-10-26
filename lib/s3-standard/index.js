const { Readable } = require('stream')
const { S3Client, GetObjectCommand, ListObjectsCommand } = require('@aws-sdk/client-s3')

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

    async onGET() {
        const command = new ListObjectsCommand({
            Bucket: this.credentials.bucket
        })
        const res = await this.client.send(command)
        return res['Contents']
    }

    async onSTREAM(name) {
        const command = new GetObjectCommand({
            Bucket: this.credentials.bucket,
            Key: name
        })
        const res = await this.client.send(command)
        return Readable.from( res.Body )
    }

}

module.exports = AWSAttachmentsService