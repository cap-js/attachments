const axios = require('axios');
const cds = require('@sap/cds');
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
    });

    const token = tokenResponse.data.access_token;
    return token;
  } catch (error) {
    DEBUG?.(`Error fetching token: ${error.message}`); 
  }
}

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

    return response.data.items[0]; 
  } catch (error) {
    DEBUG?.(`Error fetching object store credentials: ${error.message}`);
  }
}

module.exports = {
  fetchToken,
  getObjectStoreCredentials,
};