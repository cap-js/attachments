const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const { Upload } = require("@aws-sdk/lib-storage");
const cds = require("@sap/cds/lib");
module.exports = class AWSAttachmentsService extends require("./basic") {
  init() {
    const creds = this.options.credentials;
    this.bucket = creds.bucket;
    this.client = new S3Client({
      region: creds.region,
      credentials: {
        accessKeyId: creds.access_key_id,
        secretAccessKey: creds.secret_access_key,
      },
    });
    return super.init();
  }

  async initialDataUpload(Attachments, data, _content) {
    if (Array.isArray(data))
      return Promise.all(
        data.map((d) => this.initialDataUpload(Attachments, d))
      );
    const { content = _content, ...metadata } = data;
    const Key = metadata.url; //_key4 (Attachments, metadata)
    const input = {
      Bucket: this.bucket,
      Key,
      Body: content,
    };
    try {
      const multipartUpload = new Upload({
        client: new S3Client({}),
        params: input,
      });
      // TODO: add malware scan
      const stored = super.initialDataUpload(Attachments, metadata);
      await Promise.all([stored, multipartUpload.done()]);
    } catch (err) {
      console.error(err);
    }
  }

  async get(Attachments, keys) {
    let Key = "";
    let response = await SELECT.from(Attachments, keys).columns("url");
    if (response && response.url) {
      Key = response.url;
      const downloaded = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key,
        })
      );
      return downloaded.Body;
    }
  }

  async DeleteAttachment(key) {
    if (!key) return;
    return await this.delete(key);
  }

  async DeleteAttachmentsWithKeys(records, req) {
    if (req?.attachmentsToDelete?.length>0) {
      req.attachmentsToDelete.forEach((attachment) => {
        this.DeleteAttachment(attachment.url);
      });
    }
  }

  async AttachDeletionData(req) {
    let attachments = cds.model.definitions[req.query.target.name + ".attachments"];
    if (attachments) {
      const diffData = await req.diff();
      let deletedAttachments = [];
      diffData.attachments
        .filter((object) => {
          return object._op === "delete";
        })
        .map((attachment) => {
          deletedAttachments.push(attachment.ID);
        });
      let attachmentsToDelete = await SELECT.from(attachments)
        .columns("url")
        .where({ ID: { in: [...deletedAttachments] } });
      if (attachmentsToDelete.length > 0) {
        req.attachmentsToDelete = attachmentsToDelete;
      }
    }
}

  async UpdateContentHandler(req, next) {
    if (req._path.endsWith("content")) {
      let Key = "";
      let response = await SELECT.from(req.target, { ID: req.data.ID }).columns("url");
      if (response?.url) {
        Key = response.url;
        const input = {
          Bucket: this.bucket,
          Key,
          Body: req.data.content,
        };
        const multipartUpload = new Upload({
          client: new S3Client({}),
          params: input,
        });
        // TODO: add malware scan
        // const stored = super.put (Attachments, metadata)
        await Promise.all([multipartUpload.done()]);
      }
    } else {
      next();
    }
  }

  async AttachmentDataForDelete(req) {
    let attachments =
      cds.model.definitions[req.query.target.name + ".attachments"];
    if (attachments) {
      let attachmentsToDelete = await SELECT.from(attachments)
        .columns("url")
        .where({ up__ID: req.data.ID });
      if (attachmentsToDelete.length > 0) {
        req.attachmentsToDelete = attachmentsToDelete;
      }
    }
  }

  registerUpdateHandlers(srv, entity, mediaElement) {
    srv.before(["DELETE", "UPDATE"],entity,this.AttachDeletionData.bind(this));
    srv.after(["DELETE", "UPDATE"],entity,this.DeleteAttachmentsWithKeys.bind(this));
    srv.prepend(() => {
      if (mediaElement.drafts) {
        srv.on(
          "PUT",
          mediaElement.drafts,
          this.UpdateContentHandler.bind(this)
        );
      }
    });
  }

  async delete(Key) {
    const response = await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key,
      })
    );
    return response.DeleteMarker;
  }
};