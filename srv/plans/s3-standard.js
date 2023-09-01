const path = require('path')

const { S3Client, GetObjectCommand, ListObjectsCommand, PutObjectCommand } = require('@aws-sdk/client-s3')

class AWSObjectStore {

    constructor(credentials) {
        this.credentials = credentials;
        this.client = new S3Client({
            region: this.credentials.region,
            credentials: {
                accessKeyId: this.credentials.access_key_id,
                secretAccessKey: this.credentials.secret_access_key
            }
        });
    }

    async listObjects() {
        const command = new ListObjectsCommand({
            Bucket: this.credentials.bucket
        })
        try {
            const { bucket, region } = this.credentials
            const res = await this.client.send(command);
            const attachments = res['Contents']
            for (const attachment of attachments) {
                attachment.imageUrl = `https://${bucket}.s3.${region}.amazonaws.com/${attachment.Key}`
            }
            return attachments
        } catch (err) {
            return err
        }
    }

    async uploadFile(name, buffer) {
        const command = new PutObjectCommand({
            Bucket: this.credentials.bucket,
            Key: path.basename(name),
            Body: buffer,
        })
        try {
            const res = await this.client.send(command);
            console.log(res)
        } catch (err) {
            console.log(err)
            Promise.reject(err);
        }
    }

}

module.exports = {
    ObjectStore: AWSObjectStore
}
