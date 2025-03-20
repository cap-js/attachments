const { S3Client } = require('@aws-sdk/client-s3');
const axios = require('axios');
const cds = require("@sap/cds");
const DEBUG = cds.debug('attachments');

async function fetchToken(url, clientid, clientsecret) { 
    try {
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

      if (!tokenResponse.data || !tokenResponse.data.access_token) {
        throw new Error("No access_token in response!");
      }
      
      DEBUG?.(
        "Successfully fetched the token"
      );
      const token = tokenResponse.data.access_token;
      return token;
    } catch (error) {
      DEBUG?.(
        "Error fetching token",
        error
      ); 
     }
}

  //object store credentials
  async function getObjectStoreCredentials(tenantID, sm_url, token) {
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
        DEBUG?.(`No service bindings found for tenant: ${tenantID}`);
        return null;
      }

      DEBUG?.("Successfully fetched Object Store binding.");
      return response.data.items[0]; // Return the first matching service binding
    } catch (error) {
      DEBUG?.(`Error fetching Object Store credentials for tenant ${tenantID}:`, error.message);
      return null;
    }
}

  module.exports = {
    fetchToken,
    getObjectStoreCredentials,
};