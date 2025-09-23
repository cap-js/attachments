const { BlobServiceClient } = require('@azure/storage-blob');
const { scanRequest } = require('./malwareScanner')
const cds = require("@sap/cds");
const utils = require('./helper')
const DEBUG = cds.debug('attachments');
const { SELECT } = cds.ql;

const isMultitenacyEnabled = !!cds.env.requires.multitenancy;
const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind;
const separateObjectStore = isMultitenacyEnabled && objectStoreKind === "separate";

const azureClientsCache = {};
module.exports = class AzureAttachmentsService extends require("./basic") {
  init() {
    // For single tenant or shared object store instance
    if (!separateObjectStore) {
      const creds = cds.env.requires?.objectStore?.credentials;

      if (!creds) throw new Error("Azure Blob Storage credentials are not provided.");

      this.containerName = creds.container_name;
      this.blobServiceClient = new BlobServiceClient(creds.container_uri + "?" + creds.sas_token);
      this.containerClient = this.blobServiceClient.getContainerClient(creds.container_name);
      return super.init();
    }
  }

  async createAzureClient(tenantID) {
    DEBUG?.(`[Azure Upload] Creating Azure client for tenant ${tenantID}`);
    try {
      if (azureClientsCache[tenantID]) {
        this.blobServiceClient = azureClientsCache[tenantID].blobServiceClient;
        this.containerClient = azureClientsCache[tenantID].containerClient;
        this.containerName = azureClientsCache[tenantID].containerName;
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
        throw new Error(`Azure Blob Storage instance not bound for tenant ${tenantID}`);
      }

      const creds = objectStoreCreds.credentials;
      const blobServiceClient = new BlobServiceClient(creds.container_uri + "?" + creds.sas_token);
      const containerClient = blobServiceClient.getContainerClient(creds.container_name);

      azureClientsCache[tenantID] = {
        blobServiceClient,
        containerClient,
        containerName: creds.container_name,
      };

      this.blobServiceClient = azureClientsCache[tenantID].blobServiceClient;
      this.containerClient = azureClientsCache[tenantID].containerClient;
      this.containerName = azureClientsCache[tenantID].containerName;
      DEBUG?.(`[Azure Upload] Created Azure client for tenant ${tenantID}`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Creation of Azure client for tenant ${tenantID} failed`, error);
    }
  }

  async put(attachments, data, isDraftEnabled, _content, req) {
    DEBUG?.(`[Azure Upload] Executing put for file in ${attachments}`);

    // Check separate object store instances
    if (separateObjectStore) {
      const tenantID = req.tenant;
      await this.createAzureClient(tenantID);
    }

    if (Array.isArray(data))
      return Promise.all(
        data.map((d) => this.put(attachments, d, isDraftEnabled))
      );
    const { content = _content, ...metadata } = data;
    const blobName = metadata.url;

    try {
      const blobClient = this.containerClient.getBlockBlobClient(blobName);

      // Handle different content types (Buffer, stream, etc.)
      let contentLength;
      if (Buffer.isBuffer(content)) {
        contentLength = content.length;
      } else if (content && typeof content.length === 'number') {
        contentLength = content.length;
      } else if (content && typeof content.size === 'number') {
        contentLength = content.size;
      } else {
        // For streams or other content types, convert to buffer first
        const chunks = [];
        for await (const chunk of content) {
          chunks.push(chunk);
        }
        content = Buffer.concat(chunks);
        contentLength = content.length;
      }

      const stored = super.put(attachments, metadata, null, isDraftEnabled);
      await Promise.all([stored, blobClient.upload(content, contentLength)]);
      if (this.kind === 'azure') scanRequest(attachments, { ID: metadata.ID }, req);
      DEBUG?.(`[Azure Upload] File uploaded successfully using put to ${this.containerName}`);
    } catch (err) {
      console.error(err); // eslint-disable-line no-console
    }
  }

  // eslint-disable-next-line no-unused-vars
  async get(attachments, keys, req = {}) {
    DEBUG?.(`[Azure Upload] Executing get for file`);
    // Check separate object store instances
    if (separateObjectStore) {
      const tenantID = req.tenant;
      await this.createAzureClient(tenantID);
    }
    const response = await SELECT.from(attachments, keys).columns("url");
    if (response?.url) {
      const blobName = response.url;
      const blobClient = this.containerClient.getBlockBlobClient(blobName);
      const downloadResponse = await blobClient.download();
      return downloadResponse.readableStreamBody;
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
    DEBUG?.(`[Azure Upload] Uploading file using updateContentHandler for ${req.target.name}`);
    // Check separate object store instances
    if (separateObjectStore) {
      const tenantID = req.tenant;
      await this.createAzureClient(tenantID);
    }

    if (req?.data?.content) {
      const response = await SELECT.from(req.target, { ID: req.data.ID }).columns("url");
      if (response?.url) {
        const blobName = response.url;
        const blobClient = this.containerClient.getBlockBlobClient(blobName);

        // Handle different content types for update
        let contentLength;
        const content = req.data.content;
        if (Buffer.isBuffer(content)) {
          contentLength = content.length;
        } else if (content && typeof content.length === 'number') {
          contentLength = content.length;
        } else if (content && typeof content.size === 'number') {
          contentLength = content.size;
        } else {
          // Convert to buffer if needed
          const chunks = [];
          for await (const chunk of content) {
            chunks.push(chunk);
          }
          req.data.content = Buffer.concat(chunks);
          contentLength = req.data.content.length;
        }

        await blobClient.upload(req.data.content, contentLength);

        const keys = { ID: req.data.ID }
        scanRequest(req.target, keys, req)
        DEBUG?.(`[Azure Upload] Uploaded file using updateContentHandler for ${req.target.name}`);
      }
    } else if (req?.data?.note) {
      const key = { ID: req.data.ID };
      await super.update(req.target, key, { note: req.data.note });
      DEBUG?.(`[Azure Upload] Updated file upload with note for ${req.target.name}`);
    } else {
      next();
    }
  }

  async getAttachmentsToDelete({ draftEntity, activeEntity, id }) {
    const [draftAttachments, activeAttachments] = await Promise.all([
      SELECT.from(draftEntity).columns("url").where(id),
      SELECT.from(activeEntity).columns("url").where(id)
    ]);

    const activeUrls = new Set(activeAttachments.map(a => a.url));
    return draftAttachments
      .filter(({ url }) => !activeUrls.has(url))
      .map(({ url }) => ({ url }));
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

  async delete(blobName, req) {
    DEBUG?.(`[Azure Upload] Executing delete for file in ${req.target.name}`);
    // Check separate object store instances
    if (separateObjectStore) {
      const tenantID = req.tenant;
      await this.createAzureClient(tenantID);
    }

    const blobClient = this.containerClient.getBlockBlobClient(blobName);
    const response = await blobClient.delete();
    return response._response.status === 202;
  }

  async deleteInfectedAttachment(Attachments, key, req) {
    const response = await SELECT.from(Attachments, key).columns('url')
    return await this.delete(response.url, req);
  }
};
