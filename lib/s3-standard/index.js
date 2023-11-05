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

    async onPUT(entityName, items) {
        const { bucket } = this.credentials
        for (const item of items) {
            const command = new PutObjectCommand({
                Bucket: bucket,
                Key: `${entityName}-${item.fileName}`,
                Body: item.buffer,
            })
            await this.client.send(command);
        }
    }

    async onGET(ID) {
        const { bucket } = this.credentials
        const command = ID ?
            new ListObjectsCommand({ Bucket: bucket, Prefix: `sap.capire.incidents.Customers-${ID}` }) :
            new ListObjectsCommand({ Bucket: bucket })
        const res = await this.client.send(command)
        return res['Contents']
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