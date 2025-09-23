const axios = require('axios');
const https = require("https");
const { logConfig } = require('./logger');

async function getObjectStoreCredentials(tenantID, sm_url, token) {
  logConfig.processStep('Fetching object store credentials', { tenantID, sm_url });

  // Validate inputs
  if (!tenantID) {
    logConfig.withSuggestion('error', 'Tenant ID is required for object store credentials', null,
      'Ensure multitenancy is properly configured and tenant context is available', { tenantID });
    return null;
  }

  if (!sm_url) {
    logConfig.configValidation('serviceManager.credentials.sm_url', sm_url, false,
      'Bind a Service Manager instance to your application');
    return null;
  }

  if (!token) {
    logConfig.withSuggestion('error', 'Access token is required for Service Manager API', null,
      'Check if token fetching completed successfully', { hasToken: !!token });
    return null;
  }

  try {
    logConfig.debug('Making Service Manager API call', {
      tenantID,
      endpoint: `${sm_url}/v1/service_bindings`,
      labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenantID}'`
    });

    const response = await axios.get(`${sm_url}/v1/service_bindings`, {
      params: { labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenantID}'` },
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.data?.items?.length) {
      logConfig.withSuggestion('error', `No object store service binding found for tenant`, null,
        'Ensure an Object Store instance is subscribed and bound for this tenant',
        { tenantID, itemsFound: response.data?.items?.length || 0 });
      return null;
    }

    const credentials = response.data.items[0];
    logConfig.info('Object store credentials retrieved successfully', {
      tenantID,
      hasCredentials: !!credentials,
      bucket: credentials?.credentials?.bucket
    });

    return credentials;
  } catch (error) {
    const suggestion = error.response?.status === 401 ?
      'Check Service Manager credentials and token validity' :
      error.response?.status === 404 ?
        'Verify Service Manager URL and API endpoint' :
        'Check network connectivity and Service Manager instance health';

    logConfig.withSuggestion('error', 'Failed to fetch object store credentials', error, suggestion, {
      tenantID,
      sm_url,
      httpStatus: error.response?.status,
      responseData: error.response?.data
    });
    return null;
  }
}

async function fetchToken(url, clientid, clientsecret, certificate, key, certURL) {
  logConfig.processStep('Determining token fetch method', {
    hasClientCredentials: !!(clientid && clientsecret),
    hasMTLSCredentials: !!(certificate && key && certURL),
    url,
    clientid
  });

  // Validate credentials
  if (!clientid) {
    logConfig.configValidation('serviceManager.credentials.clientid', clientid, false,
      'Check Service Manager service binding for client ID');
    throw new Error("Client ID is required for token fetching");
  }

  if (certificate && key && certURL) {
    logConfig.info('Using MTLS authentication for token fetch', { clientid, certURL });
    return fetchTokenWithMTLS(certURL, clientid, certificate, key);
  } else if (clientid && clientsecret) {
    logConfig.info('Using client credentials authentication for token fetch', { clientid, url });
    return fetchTokenWithClientSecret(url, clientid, clientsecret);
  } else {
    const suggestion = 'Ensure Service Manager binding includes either (clientid + clientsecret) or (certificate + key + certurl)';
    logConfig.withSuggestion('error', 'Insufficient credentials for token fetching', null, suggestion, {
      hasClientId: !!clientid,
      hasClientSecret: !!clientsecret,
      hasCertificate: !!certificate,
      hasKey: !!key,
      hasCertURL: !!certURL
    });
    throw new Error("Invalid credentials provided for token fetching.");
  }
}

async function fetchTokenWithClientSecret(url, clientid, clientsecret) {
  const startTime = Date.now();

  try {
    logConfig.debug('Initiating OAuth client credentials flow', {
      endpoint: `${url}/oauth/token`,
      clientid
    });

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    const response = await axios.post(`${url}/oauth/token`, null, {
      headers,
      params: {
        grant_type: "client_credentials",
        client_id: clientid,
        client_secret: clientsecret,
      },
    });

    const duration = Date.now() - startTime;
    logConfig.tokenFetch('client_credentials', true, {
      clientid,
      duration,
      tokenType: response.data.token_type
    });

    return response.data.access_token;
  } catch (error) {
    const duration = Date.now() - startTime;
    const suggestion = error.response?.status === 401 ?
      'Verify Service Manager client credentials (clientid and clientsecret)' :
      error.response?.status === 404 ?
        'Check Service Manager URL is correct' :
        'Verify Service Manager instance is running and accessible';

    logConfig.tokenFetch('client_credentials', false, {
      clientid,
      duration,
      httpStatus: error.response?.status,
      errorMessage: error.message,
      suggestion
    });

    throw error;
  }
}

async function fetchTokenWithMTLS(certURL, clientid, certificate, key) {
  const startTime = Date.now();

  try {
    logConfig.debug('Initiating MTLS authentication flow', {
      endpoint: `${certURL}/oauth/token`,
      clientid
    });

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
    const duration = Date.now() - startTime;

    logConfig.tokenFetch('mtls', true, {
      clientid,
      duration,
      tokenType: response.data.token_type
    });

    return response.data.access_token;
  } catch (error) {
    const duration = Date.now() - startTime;

    logConfig.tokenFetch('mtls', false, {
      clientid,
      duration,
      httpStatus: error.response?.status,
      errorCode: error.code,
      errorMessage: error.message,
    });

    throw error;
  }
}

module.exports = {
  fetchToken,
  getObjectStoreCredentials,
};