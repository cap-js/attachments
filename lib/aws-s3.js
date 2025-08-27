const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require("@aws-sdk/lib-storage");
const { scanRequest } = require('./malwareScanner')
const cds = require("@sap/cds");
const utils = require('./helper.js')
const DEBUG = cds.debug('attachments');
const { SELECT } = cds.ql;

const isMultitenacyEnabled = !!cds.env.requires.multitenancy;
const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind;
const separateObjectStore = isMultitenacyEnabled && objectStoreKind === "separate";

const s3ClientsCache = {};
module.exports = class AWSAttachmentsService extends require("./basic") {
  init() {
    // For single tenant or shared object store instance
    if (!separateObjectStore) {
      const creds = cds.env.requires?.objectStore?.credentials;

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
    DEBUG?.(`[S3 Upload] Creating S3 client for tenant ${tenantID}`);
    try {
      if (s3ClientsCache[tenantID]) {
        this.client = s3ClientsCache[tenantID].client;
        this.bucket = s3ClientsCache[tenantID].bucket;
        return;
      }

      const serviceManagerCreds = cds.env.requires?.serviceManager?.credentials;
      if (!serviceManagerCreds) {
        throw new Error("Service Manager Instance is not bound");
      }

      const { sm_url, url, clientid, clientsecret, certificate, key, certurl } = serviceManagerCreds;
      const token = await utils.fetchToken(url, clientid, clientsecret, certificate, key, certurl);

      const objectStoreCreds = await utils.getObjectStoreCredentials(tenantID, sm_url, token);

      if (!objectStoreCreds) {
        throw new Error(`SAP Object Store instance not bound for tenant ${tenantID}`);
      }

      const s3Client = new S3Client({
        region: objectStoreCreds.credentials.region,
        credentials: {
          accessKeyId: objectStoreCreds.credentials.access_key_id,
          secretAccessKey: objectStoreCreds.credentials.secret_access_key,
        },
      });

      s3ClientsCache[tenantID] = {
        client: s3Client,
        bucket: objectStoreCreds.credentials.bucket,
      };

      this.client = s3ClientsCache[tenantID].client;
      this.bucket = s3ClientsCache[tenantID].bucket;
      DEBUG?.(`[S3 Upload] Created S3 client for tenant ${tenantID}`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Creation of S3 client for tenant ${tenantID} failed`, error);
    }
  }

  async put(attachments, data, isDraftEnabled, _content, req) {
    DEBUG?.(`[S3 Upload] Executing put for file in ${attachments}`);

    // Check separate object store instances
    if (separateObjectStore) {
      const tenantID = req.tenant;
      await this.createClientS3(tenantID);
    }

    if (Array.isArray(data))
      return Promise.all(
        data.map((d) => this.put(attachments, d, isDraftEnabled))
      );
    const { content = _content, ...metadata } = data;
    const Key = metadata.url;

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
      
      const stored = super.put(attachments, metadata, null, isDraftEnabled);
      await Promise.all([stored, multipartUpload.done()]);
      if (this.kind === 's3') scanRequest(attachments, { ID: metadata.ID }, req);
      DEBUG?.(`[S3 Upload] File uploaded successfully using put to ${this.bucket}`);
    } catch (err) {
      console.error(err); // eslint-disable-line no-console
    }
  }

  // eslint-disable-next-line no-unused-vars
  async get(attachments, keys, req = {}) {
    DEBUG?.(`[S3 Upload] Executing get for file`);
    // Check separate object store instances
    if (separateObjectStore) {
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

  async deleteAttachment(key, req) {
    if (!key) return;
    return await this.delete(key, req);
  }

  async deleteAttachmentsWithKeys(records, req) {
    if (req?.attachmentsToDelete?.length > 0) {
      req.attachmentsToDelete.forEach((attachment) => {
        this.deleteAttachment(attachment.url, req);
      });
    }
  }

  async attachDeletionData(req) {
    const attachments = cds.model.definitions[req?.target?.name + ".attachments"];
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
    DEBUG?.(`[S3 Upload] Uploading file using updateContentHandler for ${req.target.name}`);
    // Check separate object store instances
    if (separateObjectStore) {
      const tenantID = req.tenant;
      await this.createClientS3(tenantID);
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
        // const stored = super.put (Attachments, metadata)
        await Promise.all([multipartUpload.done()]);

        const keys = { ID: req.data.ID }
        scanRequest(req.target, keys, req)
        DEBUG?.(`[S3 Upload] Uploaded file using updateContentHandler for ${req.target.name}`);
      }
    } else if (req?.data?.note) {
      const key = { ID: req.data.ID };
      await super.update(req.target, key, { note: req.data.note });
      DEBUG?.(`[S3 Upload] Updated file upload with note for ${req.target.name}`);
    } else {
      next();
    }
  }

  async getAttachmentsToDelete({ draftEntity, activeEntity, id }) {
    const attachmentsStored = [];
    draftEntity ? attachmentsStored.push(SELECT.from(draftEntity).where(id).columns('url')) : null;
    activeEntity ? attachmentsStored.push(SELECT.from(activeEntity).where(id).columns('url')) : null;

    const [draftAttachments, activeAttachments] = await Promise.all(attachmentsStored);

    const activeUrls = new Set(activeAttachments.map(a => a.url));

    return attachmentsToDelete = draftAttachments
      .filter(({ url }) => !activeUrls.has(url))
  }

  async attachDraftDeletionData(req) {
    const draftEntity = cds.model.definitions[req?.target?.name];
    const name = req?.target?.name;
    const activeEntity = name ? cds.model.definitions?.[name.split(".").slice(0, -1).join(".")] : undefined;

    if (!draftEntity || !activeEntity) return;

    const diff = await req.diff();
    if (diff._op !== "delete" || !diff.ID) return;

    const attachmentsToDelete = await this.getAttachmentsToDelete({
      draftEntity,
      activeEntity,
      id: { ID: diff.ID }
    });

    if (attachmentsToDelete.length) {
      req.attachmentsToDelete = attachmentsToDelete;
    }
  }

  async attachDraftDiscardDeletionData(req) {
    const { ID } = req.data;
    const parentEntity = req.target.name.split('.').slice(0, -1).join('.');
    const draftEntity = cds.model.definitions[`${parentEntity}.attachments.drafts`];
    const activeEntity = cds.model.definitions[`${parentEntity}.attachments`];

    if (!draftEntity || !activeEntity) return;

    const attachmentsToDelete = await this.getAttachmentsToDelete({
      draftEntity,
      activeEntity,
      id: { up__ID: ID }
    });

    if (attachmentsToDelete.length) {
      req.attachmentsToDelete = attachmentsToDelete;
    }
  }

  registerUpdateHandlers(srv, entity, mediaElement) {
    srv.before(["DELETE", "UPDATE"], entity, this.attachDeletionData.bind(this));
    srv.after(["DELETE", "UPDATE"], entity, this.deleteAttachmentsWithKeys.bind(this));

    srv.prepend(() => {
      srv.on(
        "PUT",
        mediaElement,
        this.updateContentHandler.bind(this)
      );
    });
  }

  registerDraftUpdateHandlers(srv, entity, mediaElement) {
    srv.before(["DELETE", "UPDATE"], entity, this.attachDeletionData.bind(this));
    srv.after(["DELETE", "UPDATE"], entity, this.deleteAttachmentsWithKeys.bind(this));

    // case: attachments uploaded in draft and draft is discarded
    srv.before("CANCEL", entity.drafts, this.attachDraftDiscardDeletionData.bind(this));
    srv.after("CANCEL", entity.drafts, this.deleteAttachmentsWithKeys.bind(this));

    srv.prepend(() => {
      if (mediaElement.drafts) {
        srv.on(
          "PUT",
          mediaElement.drafts,
          this.updateContentHandler.bind(this)
        );

        // case: attachments uploaded in draft and deleted before saving
        srv.before(
          "DELETE",
          mediaElement.drafts,
          this.attachDraftDeletionData.bind(this)
        );
        srv.after(
          "DELETE",
          mediaElement.drafts,
          this.deleteAttachmentsWithKeys.bind(this)
        );
      }
    });
  }

  async delete(Key, req) {
    DEBUG?.(`[S3 Upload] Executing delete for file in ${req.target.name}`);
    // Check separate object store instances
    if (separateObjectStore) {
      const tenantID = req.tenant;
      await this.createClientS3(tenantID);
    }
    
    const response = await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key,
      })
    );
    return response.DeleteMarker;
  }

  async deleteInfectedAttachment(Attachments, key, req) {
    const response = await SELECT.from(Attachments, key).columns('url')
    return await this.delete(response.url, req);
  }
};
