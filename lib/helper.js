const axios = require('axios');
const cds = require('@sap/cds');
const DEBUG = cds.debug('attachments');
const https = require("https");

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

async function fetchToken(url, clientid, clientsecret, certificate, key, certURL) {
  if (certificate && key && certURL) {
    return fetchTokenWithMTLS(certURL, clientid, certificate, key);
  } else if (clientid && clientsecret) {
    return fetchTokenWithClientSecret(url, clientid, clientsecret);
  } else {
    throw new Error("Invalid credentials provided for token fetching.");
  }
}

async function fetchTokenWithClientSecret(url, clientid, clientsecret) {
  try {
    DEBUG?.("Using OAuth client credentials to fetch token.");
    const response = await axios.post(`${url}/oauth/token`, null, {
      headers,
      params: {
        grant_type: "client_credentials",
        client_id: clientid,
        client_secret: clientsecret,
      },
    });
    return response.data.access_token;
  } catch (error) {
    DEBUG?.(`Error fetching token for client credentials: ${error.message}`);
    throw error;
  }
}

async function fetchTokenWithMTLS(certURL, clientid, certificate, key) {
  try {
    DEBUG?.("Using MTLS certificate/key to fetch token.");

    const requestBody = new URLSearchParams({
      grant_type: 'client_credentials',
      response_type: 'token',
      client_id: clientid
    }).toString()

    const options = {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'    
      },
      url: `${certURL}/oauth/token`,  
      method: 'POST',
      data: requestBody,
      httpsAgent: new https.Agent({
        cert: certificate,
        key: key
      })
    }
    const response = await axios(options);
    return response.data.access_token;
  } catch (error) {
    DEBUG?.(`Error fetching token with MTLS: ${error.message}`);
    throw error;
  }
}

module.exports = {
  fetchToken,
  getObjectStoreCredentials,
};