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

    async onPUT(source, target, items) {
        const data = []
        const hasData = (await SELECT.from(target)).length > 0 ? true : false;
        if (!hasData) {
            items.forEach(item => {
                data.push({
                    entityKey: '3583f982-d7df-4aad-ab26-301d4a157cd7',
                    attachments: [{
                        fileName: item.ETag
                    }]
                })
            })
            await INSERT.into(target).entries(data)
        }
    }

    async onSTREAM(name) {
        const command = new GetObjectCommand({
            Bucket: this.credentials.bucket,
            Key: name
        })
        const res = await this.client.send(command)
        return Readable.from(res.Body)
    }

}

module.exports = AWSAttachmentsService