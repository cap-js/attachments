const axios = require('axios')
const https = require("https")
const crypto = require("crypto")
const stream = require('stream/promises')
const cds = require('@sap/cds')
const LOG = cds.log("attachments")

/**
 * Validates the presence of required Service Manager credentials
 * @param {*} serviceManagerCreds - Service Manager credentials object
 * @throws Will throw an error if validation fails
 */
function validateServiceManagerCredentials(serviceManagerCreds) {
  if (!serviceManagerCreds) {
    LOG.error('serviceManager.credentials is missing',
      'Bind a Service Manager instance for separate object store mode')
    throw new Error("Service Manager Instance is not bound")
  }

  const requiredSmFields = ['sm_url', 'url', 'clientid']
  const missingSmFields = requiredSmFields.filter(field => !serviceManagerCreds[field])

  if (missingSmFields.length > 0) {
    LOG.error('serviceManager.credentials is missing a few fields. Passed object: ', serviceManagerCreds,
      `Service Manager credentials missing: ${missingSmFields.join(', ')}`)
    throw new Error(`Missing Service Manager credentials: ${missingSmFields.join(', ')}`)
  }
}

/**
 * Validates the inputs required for fetching object store credentials
 * @param {string} tenantID - Tenant ID
 * @param {string} sm_url - Service Manager URL
 * @param {string} token - Access token
 * @returns 
 */
function validateInputs(tenantID, sm_url, token) {
  if (!tenantID) {
    LOG.error( 'Tenant ID is required for object store credentials', null,
      'Ensure multitenancy is properly configured and tenant context is available', { tenantID })
    return false
  }

  if (!sm_url) {
    LOG.error('serviceManager.credentials.sm_url', sm_url, false,
      'Bind a Service Manager instance to your application')
    return false
  }

  if (!token) {
    LOG.error( 'Access token is required for Service Manager API', null,
      'Check if token fetching completed successfully', { hasToken: !!token })
    return false
  }

  return true
}

/**
 * Fetches object store service binding from Service Manager
 * @param {string} tenantID - Tenant ID
 * @param {string?} token - Access token, if nothing is provided access token is fetched
 * @returns {Promise<Array>} - Promise resolving to array of service bindings
 */
async function fetchObjectStoreBinding(tenantID, token) {
  const serviceManagerCreds = cds.env.requires?.serviceManager?.credentials

  validateServiceManagerCredentials(serviceManagerCreds)

   const { sm_url, url, clientid, clientsecret, certificate, key, certurl } = serviceManagerCreds

   
   if (!token) {
     LOG.debug('Fetching access token for tenant', { tenantID, sm_url: sm_url })
     token = await fetchToken(url, clientid, clientsecret, certificate, key, certurl)
   }
   
   LOG.debug('Fetching object store credentials', { tenantID, sm_url })
   
   if (!validateInputs(tenantID, sm_url, token)) {
     return null
    }
    
  LOG.debug('Making Service Manager API call', {
    tenantID,
    endpoint: `${sm_url}/v1/service_bindings`,
    labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenantID}'`
  })
  const response = await axios.get(`${sm_url}/v1/service_bindings`, {
    params: { labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenantID}'` },
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })

  return response.data?.items || []
}

/**
 * Retrieves object store credentials for a given tenant
 * @param {*} tenantID - Tenant ID
 * @returns {Promise<Object|null>} - Promise resolving to object store credentials or null
 */
async function getObjectStoreCredentials(tenantID) {
  try {
    const items = await fetchObjectStoreBinding(tenantID)

    if (!items.length) {
      LOG.error( `No object store service binding found for tenant`, null,
        'Ensure an Object Store instance is subscribed and bound for this tenant',
        { tenantID, itemsFound: 0 })
      return null
    }

    const credentials = items[0]
    LOG.info('Object store credentials retrieved successfully', {
      tenantID,
      hasCredentials: !!credentials,
      bucket: credentials?.credentials?.bucket
    })

    return credentials
  } catch (error) {
    const suggestion = error.response?.status === 401 ?
      'Check Service Manager credentials and token validity' :
      error.response?.status === 404 ?
        'Verify Service Manager URL and API endpoint' :
        'Check network connectivity and Service Manager instance health'

    LOG.error( 'Failed to fetch object store credentials', error, suggestion, {
      tenantID,
      httpStatus: error.response?.status,
      responseData: error.response?.data
    })
    return null
  }
}

/**
 * Fetches an OAuth token using either client credentials or MTLS
 * @param {string} url - Token endpoint URL
 * @param {string} clientid - Client ID
 * @param {string} clientsecret - Client Secret
 * @param {string} certificate - MTLS Certificate
 * @param {string} key - MTLS Key
 * @param {string} certURL - MTLS Certificate URL
 * @returns {Promise<string>} - Promise resolving to access token
 */
async function fetchToken(url, clientid, clientsecret, certificate, key, certURL) {
  LOG.info('Determining token fetch method', {
    hasClientCredentials: !!(clientid && clientsecret),
    hasMTLSCredentials: !!(certificate && key && certURL),
    url,
    clientid
  })

  // Validate credentials
  if (!clientid) {
    LOG.error('serviceManager.credentials.clientid is missing',
      'Check Service Manager service binding for client ID')
    throw new Error("Client ID is required for token fetching")
  }

  if (certificate && key && certURL) {
    LOG.debug('Using MTLS authentication for token fetch', { clientid, certURL })
    return fetchTokenWithMTLS(certURL, clientid, certificate, key)
  } else if (clientid && clientsecret) {
    LOG.debug('Using client credentials authentication for token fetch', { clientid, url })
    return fetchTokenWithClientSecret(url, clientid, clientsecret)
  } else {
    const suggestion = 'Ensure Service Manager binding includes either (clientid + clientsecret) or (certificate + key + certurl)'
    LOG.error( 'Insufficient credentials for token fetching', null, suggestion, {
      hasClientId: !!clientid,
      hasClientSecret: !!clientsecret,
      hasCertificate: !!certificate,
      hasKey: !!key,
      hasCertURL: !!certURL
    })
    throw new Error("Invalid credentials provided for token fetching.")
  }
}

/**
 * Fetches OAuth token using client credentials flow
 * @param {string} url - Token endpoint URL
 * @param {string} clientid - Client ID
 * @param {string} clientsecret - Client Secret
 * @returns 
 */
async function fetchTokenWithClientSecret(url, clientid, clientsecret) {
  const startTime = Date.now()

  try {
    LOG.debug('Initiating OAuth client credentials flow', {
      endpoint: `${url}/oauth/token`,
      clientid
    })

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    }

    const response = await axios.post(`${url}/oauth/token`, null, {
      headers,
      params: {
        grant_type: "client_credentials",
        client_id: clientid,
        client_secret: clientsecret,
      },
    })

    const duration = Date.now() - startTime
    LOG.debug('OAuth token fetched successfully', { clientid, duration, tokenType: response.data?.token_type })

    return response.data.access_token
  } catch (error) {
    const duration = Date.now() - startTime
    const suggestion = error.response?.status === 401 ?
      'Verify Service Manager client credentials (clientid and clientsecret)' :
      error.response?.status === 404 ?
        'Check Service Manager URL is correct' :
        'Verify Service Manager instance is running and accessible'

    LOG.error(
      'Failed to fetch OAuth token using client credentials', error,
      suggestion,
      { clientid, duration, httpStatus: error.response?.status, errorMessage: error.message })

    throw error
  }
}

/**
 * Fetches OAuth token using MTLS authentication
 * @param {string} certURL - Certificate URL
 * @param {string} clientid - Client ID
 * @param {string} certificate - MTLS Certificate
 * @param {string} key - MTLS Key
 * @returns {Promise<string>} - Promise resolving to access token
 */
async function fetchTokenWithMTLS(certURL, clientid, certificate, key) {
  const startTime = Date.now()

  try {
    LOG.debug('Initiating MTLS authentication flow', {
      endpoint: `${certURL}/oauth/token`,
      clientid
    })

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

    const response = await axios(options)
    const duration = Date.now() - startTime

    if (!response.data?.access_token) {
      LOG.error( 'MTLS token response missing access_token', null,
        'Check MTLS certificate/key validity and Service Manager configuration',
        { clientid, duration, responseData: response.data })
      throw new Error('Access token not found in MTLS token response')
    }

    LOG.debug('MTLS token fetched successfully', { clientid, duration, tokenType: response.data.token_type })

    return response.data.access_token
  } catch (error) {
    const duration = Date.now() - startTime

    LOG.error(
      'Failed to fetch OAuth token using MTLS', error,
      'Check MTLS certificate, key, and Service Manager connectivity',
      { clientid, duration, httpStatus: error.response?.status, errorMessage: error.message })

    throw error
  }
}

/**
 * Checks if the given mimeType matches any of the allowedTypes patterns
 * @param {Array<string>} allowedTypes - Array of allowed mime types (can include wildcards)
 * @param {string} mimeType - Mime type to check
 * @returns {boolean} - True if mimeType matches any allowedTypes, false otherwise
 */
function checkMimeTypeMatch(allowedTypes, mimeType) {
  if (!allowedTypes || allowedTypes.length === 0) {
    return true
  }

  return allowedTypes.some(allowedType => {
    if (allowedType.endsWith('/*')) {
      const prefix = allowedType.slice(0, -2)
      return mimeType.startsWith(prefix + '/')
    } else {
      return mimeType === allowedType
    }
  })
}

async function computeHash(input) {
  const hash = crypto.createHash('sha256')

  // Connect the output of the `input` stream to the input of `hash`
  // and let Node.js do the streaming
  await stream.pipeline(input, hash)

  return hash.digest('hex')
}

module.exports = {
  fetchToken,
  getObjectStoreCredentials,
  computeHash,
  fetchObjectStoreBinding,
  validateServiceManagerCredentials,
  checkMimeTypeMatch
}