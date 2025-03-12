const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require("@aws-sdk/lib-storage");
const { scanRequest } = require('./malwareScanner')
const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const xsenv = require('@sap/xsenv');
const axios = require('axios');
const profile = cds.env.profile;
const s3ClientsCache = {};
module.exports = class AWSAttachmentsService extends require("./basic") {
  async _fetchToken(url, clientid, clientsecret, tenantID) {
    console.log("inside fetch token method");
    try {
      const tokenResponse = await axios.post(`${url}/oauth/token`, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        params: {
          grant_type: 'client_credentials',
          client_id: clientid,
          client_secret: clientsecret
        }
      })

      const token = tokenResponse.data.access_token;
      return token;
    } catch (erroe) {
      console.log("error occured while fetching the toekn")
    }
  }

  //object store credentials
  async _getObjectStoreCredentials(tenantID, sm_url, token) {
    console.log("inside getobjectStoreCredentials method")
    try {
      const response = await axios.get(`${sm_url}/v1/service_bindings`, {
        params: { labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenantID}'` },
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.data || !response.data.items || response.data.items.length === 0) {
        console.error(`No service bindings found for tenant: ${tenantID}`);
        return null;
      }

      console.log("Successfully fetched Object Store binding.");
      return response.data.items[0]; // Return the first matching service binding
    } catch (error) {
      console.error(`Error fetching Object Store credentials for tenant ${tenantID}:`, error.message);
      return null;
    }
  }
  async createClientS3(tenantID) {
    console.log("Inside createClientS3");
    
    if (profile === 'mtx-sidecar') {
        // Check if the tenant's S3Client is already cached
        if (s3ClientsCache[tenantID]) {
            return s3ClientsCache[tenantID];
        }

        const { sm_url, url, clientid, clientsecret } = this.options.credentials;
        const token = await this._fetchToken(url, clientid, clientsecret);
        const objectStoreCredentials = await this._getObjectStoreCredentials(tenantID, sm_url, token);

        // Create S3Client instance
        const s3Client = new S3Client({
            region: objectStoreCredentials.credentials.region,
            credentials: {
                accessKeyId: objectStoreCredentials.credentials.access_key_id,
                secretAccessKey: objectStoreCredentials.credentials.secret_access_key,
            },
        });

        // Store both client and bucket separately in the cache
        s3ClientsCache[tenantID] = {
            client: s3Client,
            bucket: objectStoreCredentials.credentials.bucket,
        };

        console.log("S3 client bucket response", s3ClientsCache[tenantID]);
        return s3ClientsCache[tenantID];
    } 

    // Handling single-tenant mode
    return this.initSingleTenantS3();
}

initSingleTenantS3() {
    console.log("Initializing Single-Tenant S3 Client");
    
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

    console.log("Single-Tenant S3 Client initialized successfully.");
    return { client: this.client, bucket: this.bucket };
}

  async put(attachments, data, _content, req) {
    console.log("inside put method");
    const tenantID = req.tenant;
    const { client, bucket } = await this.createClientS3(tenantID);
    if (Array.isArray(data))
      return Promise.all(
        data.map((d) => this.put(attachments, d))
      );
    const { content = _content, ...metadata } = data;
    const Key = metadata.url;
    const input = {
      Bucket: bucket,
      Key,
      Body: content,
    };
    try {
      const multipartUpload = new Upload({
        client: client,
        params: input,
      });

      const stored = await super.put(attachments, metadata);
      await Promise.all([stored, multipartUpload.done()]);
      if (this.kind === 's3') scanRequest(attachments, { ID: metadata.ID })
    } catch (err) {
      console.log("error in put method")
      console.error(err);
    }
  }

  async get(attachments, keys, req = {}) {
    console.log("inside get method");
    const tenantID = req.tenant;
    const { client, bucket } = await this.createClientS3(tenantID);
    const response = await SELECT.from(attachments, keys).columns("url");
    if (response?.url) {
      const Key = response.url;
      const content = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key,
        })
      );
      return content.Body;
    }
  }

  async deleteAttachment(key) {
    console.log("inside deleteAttachment method")
    if (!key) return;
    return await this.delete(key);
  }

  async deleteAttachmentsWithKeys(records, req) {
    console.log("inside deleteAttachmentsWithKeys method")
    if (req?.attachmentsToDelete?.length > 0) {
      req.attachmentsToDelete.forEach((attachment) => {
        this.deleteAttachment(attachment.url);
      });
    }
  }

  async attachDeletionData(req) {
    console.log("inside attachDeletionData method ")
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
    console.log("inside updateContentHandler method")
    const tenantID = req.tenant;
    const { client, bucket } = await this.createClientS3(tenantID);
    if (req?.data?.content) {
      const response = await SELECT.from(req.target, { ID: req.data.ID }).columns("url");
      if (response?.url) {
        const Key = response.url;
        const input = {
          Bucket: bucket,
          Key,
          Body: req.data.content,
        };
        const multipartUpload = new Upload({
          client: client,
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
    console.log("inside registerUpdateHandlers method")
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
    console.log("inside delete method");
    const tenantID = req.tenant;
    const { client, bucket } = await this.createClientS3(tenantID);
    const response = await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key,
      })
    );
    return response.DeleteMarker;
  }

  async deleteInfectedAttachment(Attachments, key) {
    console.log("inside deleteInfectedAttachment method");
    const response = await SELECT.from(Attachments, key).columns('url')
    return await this.delete(response.url);
  }
};
