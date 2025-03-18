const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require("@aws-sdk/lib-storage");
const { scanRequest } = require('./malwareScanner')
const cds = require("@sap/cds");
const { SELECT } = cds.ql;
// const xsenv = require('@sap/xsenv');
const axios = require('axios');
const profile_multitenacy = cds.env.requires.multitenancy._is_linked;
const s3ClientsCache = {};
module.exports = class AWSAttachmentsService extends require("./basic") {
  async _fetchToken(url, clientid, clientsecret) {
    console.log("inside fetch token method");
    try {
      console.log("inside inside fetch toekn method")
      const tokenResponse = await axios.post(`${url}/oauth/token`, null, {
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

      console.log("Full tokenResponse:", tokenResponse.data); // Log full response

      if (!tokenResponse.data || !tokenResponse.data.access_token) {
        throw new Error("No access_token in response!");
      }

      const token = tokenResponse.data.access_token;
      console.log(`Fetched token: ${token}`);
      return token;
    } catch (error) {
      console.log("error occured while fetching the token", error)
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
    console.log("Inside createClientS3 for tenant:", tenantID);
    console.log("Checking the profile...");
    console.log(" Profile inside createClientS3:", profile_multitenacy);

    try {
      if (profile_multitenacy) {
        console.log("Multi-tenant mode detected");

        if (s3ClientsCache[tenantID]) {
          console.log(" Returning cached S3 client for tenant:", tenantID);
          return s3ClientsCache[tenantID];
        }

        console.log("Fetching service manager credentials...");
        console.log("CDS env requires.serviceManager:", cds.env.requires.serviceManager);
        console.log("CDS env serviceManager.credentials:", cds.env.requires.serviceManager.credentials);

        if (!cds.env.requires.serviceManager || !cds.env.requires.serviceManager.credentials) {
          throw new Error("Missing `serviceManager.credentials` in environment configuration!");
        }

        const { sm_url, url, clientid, clientsecret } = cds.env.requires.serviceManager.credentials;
        console.log(" sm_url:", sm_url); // This should now print
        console.log(" url:", url);
        console.log("clientid:", clientid);
        console.log(" clientsecret:", clientsecret);

        console.log("Fetching token...");
        const token = await this._fetchToken(url, clientid, clientsecret);
        console.log(" Token received:", token);

        console.log("Fetching object store credentials...");
        const objectStoreCredentials = await this._getObjectStoreCredentials(tenantID, sm_url, token);
        console.log(" Object Store Credentials received:", objectStoreCredentials);

        if (!objectStoreCredentials || !objectStoreCredentials.credentials) {
          throw new Error(` Missing 'credentials' property in object store response for tenant: ${tenantID}`);
        }

        console.log(" Creating S3 Client...");
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

        console.log(" S3 client bucket response:", s3ClientsCache[tenantID]);
        return s3ClientsCache[tenantID];
      } else {
        console.log(" Single-tenant mode detected. Switching to single-tenant S3 setup...");
        return this.initSingleTenantS3();
      }
    } catch (error) {
      console.error("Error in createClientS3:", error);
      throw error;
    }
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

    //check for client and bucket
    if (!client || !bucket) {
      console.error("S3 Client or Bucket not found!");
      throw new Error("S3 Client or Bucket is undefined.");
    }

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
      console.log(`Uploading file: ${Key} to bucket: ${bucket}`);
      const stored = await super.put(attachments, metadata);
      await Promise.all([stored, multipartUpload.done()]);
      console.log("Upload completed successfully.");
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
    console.log("before fetching client bucket in updateContentHandler")
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
