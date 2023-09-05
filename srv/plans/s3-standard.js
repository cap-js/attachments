const path = require('path')
const fsp = require('fs').promises

const { Readable } = require('stream')
const { parseUrl } = require('@smithy/url-parser')

const { S3Client, DeleteObjectCommand, GetObjectCommand, ListObjectsCommand, PutObjectCommand } = require('@aws-sdk/client-s3')

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
            const res = await this.client.send(command)
            const attachments = res['Contents']

            for (const attachment of attachments) {
                const url = parseUrl(`https://${bucket}.s3.${region}.amazonaws.com/${attachment.Key}`)
            }
            return attachments
        } catch (err) {
            return err
        }
    }

    async getObjectAsStream(name) {
        const command = new GetObjectCommand({
            Bucket: this.credentials.bucket,
            Key: name
        })
        try {
            const res = await this.client.send(command)
            return Readable.from( res.Body )
        } catch (err) {
            console.log(err)
            Promise.reject(err);
        }
    }

    async uploadFile(name, buffer) {
        const extname = path.extname(name)
        let type;
        switch (extname) {
            case '.jpg':
            case '.jpeg':
                type = 'image/jpg'
                break
            case '.png':
                type = 'image/png'
                break
        }
        if (type) {
            const command = new PutObjectCommand({
                Bucket: this.credentials.bucket,
                Key: path.basename(name),
                Body: buffer,
                ContentType: type
            })
            try {
                const res = await this.client.send(command);
                console.log(res)
            } catch (err) {
                console.log(err)
                Promise.reject(err);
            }
        } else {
            Promise.reject('Unknown media type!')
        }
    }

    async uploadBulk() {
        const imageDir = path.join(cds.env._home, 'db/data')
        const imageFiles = await fsp.readdir(imageDir)
        for (const imageFile of imageFiles) {
            const imagePath = path.join(imageDir, imageFile)
            const buffer = await fsp.readFile(imagePath);
            await this.uploadFile(path.basename(imagePath), buffer)
        }
    }

    async emptyBucket() {
        const imageDir = path.join(cds.env._home, 'db/data')
        const imageFiles = await fsp.readdir(imageDir)
        for (const imageFile of imageFiles) {
            const command = new DeleteObjectCommand({
                Bucket: this.credentials.bucket,
                Key: imageFile,
            })
            try {
            const res = await this.client.send(command);
                console.log(res);
            } catch (err) {
                console.error(err);
            }
        }
    }

}

module.exports = {
    ObjectStore: AWSObjectStore
}
