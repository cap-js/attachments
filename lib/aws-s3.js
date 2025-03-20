const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require("@aws-sdk/lib-storage");
const { scanRequest } = require('./malwareScanner')
const cds = require("@sap/cds");
const DEBUG = cds.debug('attachments');
const { SELECT } = cds.ql;
const utils = require('./helper.js')
const profile_multitenacy = cds.env.requires.multitenancy._is_linked;
const s3ClientsCache = {};
module.exports = class AWSAttachmentsService extends require("./basic") {
  init() {
    if (!profile_multitenacy && cds.env.requires.attachments.objectstore.kind != "separate") {
      const creds = this.options.credentials;

      if (!creds) throw new Error("SAP Object Store instance is not bound.");

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
  }
  
  async createClientS3(tenantID) {
    try {
      if (profile_multitenacy) {
        if (s3ClientsCache[tenantID]) {
          DEBUG?.(" Returning cached S3 client for tenant:", tenantID);
          // return s3ClientsCache[tenantID];
          this.client = s3ClientsCache[tenantID].client;
          this.bucket = s3ClientsCache[tenantID].bucket;
          return;
        }

        if (!cds.env.requires.serviceManager || !cds.env.requires.serviceManager.credentials) {
          throw new Error("Missing `serviceManager.credentials` in environment configuration!");
        }

        const { sm_url, url, clientid, clientsecret } = cds.env.requires.serviceManager.credentials;
        const token = await utils.fetchToken(url, clientid, clientsecret);
        DEBUG?.(" Token received:");

        const objectStoreCredentials = await utils.getObjectStoreCredentials(tenantID, sm_url, token);
        DEBUG?.(" Object Store Credentials received:", objectStoreCredentials);

        if (!objectStoreCredentials || !objectStoreCredentials.credentials) {
          throw new Error(` Missing 'credentials' property in object store response for tenant: ${tenantID}`);
        }

        const s3Client = new S3Client({
          region: objectStoreCredentials.credentials.region,
          credentials: {
            accessKeyId: objectStoreCredentials.credentials.access_key_id,
            secretAccessKey: objectStoreCredentials.credentials.secret_access_key,
          },
        });

        s3ClientsCache[tenantID] = {
          client: s3Client,
          bucket: objectStoreCredentials.credentials.bucket,
        };

        DEBUG?.(" S3 client bucket successfully got created");
        DEBUG?.(" S3 client bucket response:", s3ClientsCache[tenantID]);
        this.client = s3ClientsCache[tenantID].client;
        this.bucket = s3ClientsCache[tenantID].bucket;
      }
    } catch (error) {
      DEBUG?.("Error in createClientS3 creation:", error);
      throw error;
    }
  }

  async put(attachments, data, _content, req) {
    if (profile_multitenacy) {
      const tenantID = req.tenant;
      await this.createClientS3(tenantID);
    }
    if (!this.client || !this.bucket) {
      throw new Error("S3 Client or Bucket is not initialized. Cannot perform upload.");
    }
    if (Array.isArray(data))
      return Promise.all(
        data.map((d) => this.put(attachments, d))
      );
    const { content = _content, ...metadata } = data;
    const Key = metadata.url;

    //check for client and bucket
    if (!this.client || !this.bucket) {
      DEBUG?.("S3 Client or Bucket not found!");
      throw new Error("S3 Client or Bucket is undefined.");
    }

    const input = {
      Bucket: this.bucket,
      Key,
      Body: content,
    };
    try {
      const multipartUpload = new Upload({
        client: this.client,
        params: input,
      });
      const stored = await super.put(attachments, metadata);
      await Promise.all([stored, multipartUpload.done()]);
      DEBUG?.("Upload completed successfully.");
      if (this.kind === 's3') scanRequest(attachments, { ID: metadata.ID })
    } catch (err) {
      DEBUG?.("error in put method")
    }
  }

  async get(attachments, keys, req = {}) {
    if (profile_multitenacy) {
      const tenantID = req.tenant;
      await this.createClientS3(tenantID);
    }
    const response = await SELECT.from(attachments, keys).columns("url");
    if (response?.url) {
      const Key = response.url;
      const content = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key,
        })
      );
      return content.Body;
    }
  }

  async deleteAttachment(key) {
    if (!key) return;
    return await this.delete(key);
  }

  async deleteAttachmentsWithKeys(records, req) {
    if (req?.attachmentsToDelete?.length > 0) {
      req.attachmentsToDelete.forEach((attachment) => {
        this.deleteAttachment(attachment.url);
      });
    }
  }

  async attachDeletionData(req) {
    const attachments = cds.model.definitions[req.query.target.name + ".attachments"];
    if (attachments) {
      const diffData = await req.diff();
      let deletedAttachments = [];
      diffData.attachments?.filter((object) => {
        return object._op === "delete";
      })
        .map((attachment) => {
          deletedAttachments.push(attachment.ID);
        });

      if (deletedAttachments.length > 0) {
        let attachmentsToDelete = await SELECT.from(attachments).columns("url").where({ ID: { in: [...deletedAttachments] } });
        if (attachmentsToDelete.length > 0) {
          req.attachmentsToDelete = attachmentsToDelete;
        }
      }
    }
  }

  async updateContentHandler(req, next) {
    if (profile_multitenacy) {
      const tenantID = req.tenant;
      await this.createClientS3(tenantID);
    }
    if (!this.client || !this.bucket) {
      throw new Error("S3 Client or Bucket is not initialized. Cannot perform update.");
    }

    if (req?.data?.content) {
      const response = await SELECT.from(req.target, { ID: req.data.ID }).columns("url");
      if (response?.url) {
        const Key = response.url;
        const input = {
          Bucket: this.bucket,
          Key,
          Body: req.data.content,
        };
        const multipartUpload = new Upload({
          client: this.client,
          params: input,
        });
        // TODO: add malware scan
        // const stored = super.put (Attachments, metadata)
        await Promise.all([multipartUpload.done()]);

        const keys = { ID: req.data.ID }
        scanRequest(req.target, keys)
      }
    } else if (req?.data?.note) {
      const key = { ID: req.data.ID };
      await super.update(req.target, key, { note: req.data.note });
    } else {
      next();
    }
  }

  registerUpdateHandlers(srv, entity, mediaElement) {
    srv.before(["DELETE", "UPDATE"], entity, this.attachDeletionData.bind(this));
    srv.after(["DELETE", "UPDATE"], entity, this.deleteAttachmentsWithKeys.bind(this));
    srv.prepend(() => {
      if (mediaElement.drafts) {
        srv.on(
          "PUT",
          mediaElement.drafts,
          this.updateContentHandler.bind(this)
        );
      }
    });
  }

  async delete(Key, req) {
    if (profile_multitenacy) {
      const tenantID = req.tenant;
      await this.createClientS3(tenantID);
    }
    if (!this.client || !this.bucket) {
      throw new Error("S3 Client or Bucket is not initialized. Cannot perform delete attachments.");
    }
    const response = await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key,
      })
    );
    return response.DeleteMarker;
  }

  async deleteInfectedAttachment(Attachments, key) {
    const response = await SELECT.from(Attachments, key).columns('url')
    return await this.delete(response.url);
  }
};
