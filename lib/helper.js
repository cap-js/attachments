const axios = require('axios');

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
    console.error(`Error fetching token: ${error.message}`); // eslint-disable-line no-console
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
    console.error(`Error fetching object store credentials: ${error.message}`); // eslint-disable-line no-console
  }
}

module.exports = {
  fetchToken,
  getObjectStoreCredentials,
};