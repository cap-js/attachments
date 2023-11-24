const { pipeline, Readable } = require('stream')
const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsCommand } = require('@aws-sdk/client-s3')
const { Upload } = require("@aws-sdk/lib-storage")

const AttachmentsService = require('../common')

class AWSAttachmentsService extends AttachmentsService {

    async init() {
        super.init()

        this.client = new S3Client({
            region: this.credentials.region,
            credentials: {
                accessKeyId: this.credentials.access_key_id,
                secretAccessKey: this.credentials.secret_access_key
            }
        })
        this.db = await cds.connect.to('db')

    }

    async onGET(ID) {
        const { bucket } = this.credentials
        const command = ID ?
            new ListObjectsCommand({ Bucket: bucket, Prefix: `${ID}.png` }) :
            new ListObjectsCommand({ Bucket: bucket })
        const res = await this.client.send(command)
        return res['Contents']
    }

    async onPUT(ID, content) {
        const fileBuffer = new Buffer.from(content, 'base64')
        let bytes = 0
        const stream = new Readable({
            read() {
                this.push(fileBuffer);
                this.push(null)
            }
        });
        stream.on("data", (chunk) => {
            bytes += chunk.length;
        })
        const parallelUpload = new Upload({
            client: this.client,
            params: {
                Bucket: this.credentials.bucket,
                Key: `${ID}.png`,
                Body: stream
            },
        });
        return await parallelUpload.done()
    }

    async onSTREAM(entity, ID) {
        const command = new GetObjectCommand({
            Bucket: this.credentials.bucket,
            Key: `${ID}.png`
        })
        const res = await this.client.send(command)
        return res.Body
    }

}

module.exports = AWSAttachmentsService