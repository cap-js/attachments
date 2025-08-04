const axios = require('axios');
const cds = require('@sap/cds');
const DEBUG = cds.debug('attachments');

async function fetchToken(url, clientid, clientsecret, certificate, key) {
  try {
    const tokenUrl = `${url}/oauth/token`;
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    };
    const body = "grant_type=client_credentials";

    // Case 1: OAuth Client Credentials Flow
    if (clientid && clientsecret) {
      DEBUG?.("Using OAuth client credentials to fetch token.");
      const response = await axios.post(tokenUrl, null, {
        headers,
        params: {
          grant_type: "client_credentials",
          client_id: clientid,
          client_secret: clientsecret,
        },
      });
      return response.data.access_token;
    }

    DEBUG?.("Client credentials missing, falling back to MTLS...");

    // Case 2: MTLS Flow
    if (certificate && key) {
      DEBUG?.("Using MTLS certificate/key to fetch token.");

      // Replace literal "\n" with actual newlines
      if (typeof certificate === "string") {
        certificate = certificate.replace(/\\n/g, "\n");
      }
      if (typeof key === "string") {
        key = key.replace(/\\n/g, "\n");
      }

      const agent = new https.Agent({ cert: certificate, key: key });

      const response = await axios.post(tokenUrl, body, {
        headers,
        httpsAgent: agent,
      });

      return response.data.access_token;
    }

    throw new Error("Missing authentication credentials: Provide either OAuth clientid/clientsecret or MTLS certificate/key.");
  } catch (error) {
    DEBUG?.(`Error fetching token from service manager: ${error.message}`);
    throw error;
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