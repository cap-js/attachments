const cds = require('@sap/cds')
const LOG = cds.log('attachments')
const axios = require('axios')
const https = require("https")
const { validateServiceManagerCredentials, fetchObjectStoreBinding } = require('../helper')

const PATH = {
    SERVICE_INSTANCE: "v1/service_instances",
    SERVICE_BINDING: "v1/service_bindings",
    SERVICE_PLAN: "v1/service_plans",
    SERVICE_OFFERING: "v1/service_offerings"
}

const HTTP_METHOD = {
    POST: "post",
    GET: "get",
    DELETE: "delete"
}

const STATE = {
    SUCCEEDED: "succeeded",
    FAILED: "failed",
}

let POLL_WAIT_TIME = 5000
const ASYNC_TIMEOUT = 5 * 60 * 1000

/**
 * Waits for the specified number of milliseconds
 * @param {number} milliseconds - Time to wait in milliseconds
 * @returns {Promise} - Resolves after the specified time
 */
async function wait(milliseconds) {
    if (milliseconds <= 0) {
        return
    }
    await new Promise(function (resolve) {
        setTimeout(resolve, milliseconds)
    })
}

/**
 * Registers attachment handlers for the given service and entity
 * @param {string} sm_url - Service Manager URL
 * @param {import('axios').Method} method - HTTP method
 * @param {string} path - API path
 * @param {string} token - OAuth token
 * @param {*} params - Query parameters
 * @returns {string} - Response data
 */
const _serviceManagerRequest = async (sm_url, method, path, token, params = {}) => {
    try {
        const response = await axios({
            method,
            url: `${sm_url}/${path}`,
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            params
        })

        return response?.data?.items?.[0] // Error handling : return undefined instead of crashing when .items is undefined

    } catch (error) {
        LOG.error(`Service Manager API request failed - ${method.toUpperCase()} ${path}`, error,
            'Check Service Manager connectivity and credentials',
            { method, path, sm_url, params })
        throw error
    }
}

const _fetchToken = async (url, clientid, clientsecret, certificate, key) => {
    try {
        const tokenUrl = `${url}/oauth/token`
        const headers = {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        const body = "grant_type=client_credentials"

        // Case 1: OAuth Client Credentials Flow
        if (clientid && clientsecret) {
            LOG.debug('Using OAuth client credentials to fetch token.', { url, clientid })
            const response = await axios.post(tokenUrl, null, {
                headers,
                params: {
                    grant_type: "client_credentials",
                    client_id: clientid,
                    client_secret: clientsecret,
                },
            })

            if (!response.data?.access_token) {
                LOG.error('OAuth token response missing access_token', null,
                    'Check clientid/clientsecret validity and Service Manager configuration',
                    { clientid, responseData: response.data })
                throw new Error('Access token not found in OAuth token response')
            }

            return response.data.access_token
        }

        LOG.debug('OAuth client credentials missing - checking for MTLS credentials', { url, clientid })

        // Case 2: MTLS Flow
        if (certificate && key) {
            LOG.debug('MTLS certificate and key found - proceeding with MTLS token fetch.', { url, clientid })
            const agent = new https.Agent({ cert: certificate, key: key })

            const response = await axios.post(tokenUrl, body, {
                headers,
                httpsAgent: agent,
            })

            if (!response.data?.access_token) {
                LOG.error('MTLS token response missing access_token', null,
                    'Check MTLS certificate/key validity and Service Manager configuration',
                    { clientid, responseData: response.data })
                throw new Error('Access token not found in MTLS token response')
            }

            return response.data.access_token
        }

        // If neither flow is possible
        throw new Error("Missing authentication credentials: Provide either OAuth clientid/clientsecret or MTLS certificate/key.")
    } catch (error) {
        LOG.error('Failed to fetch OAuth token using provided credentials', error,
            'Verify Service Manager credentials and connectivity')
        throw error
    }
}

const _getOfferingID = async (sm_url, token) => {
    const offerings = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_OFFERING, token, { fieldQuery: "name eq 'objectstore'" })
    const offeringID = offerings.id
    if (!offeringID) LOG.debug('Object store service offering not found in Service Manager', { sm_url })
    return offeringID
}

/**
 * Registers attachment handlers for the given service and entity
 * @param {string} sm_url - Service Manager URL
 * @param {string} token - OAuth token
 * @param {string} offeringID - Service Offering ID
 * @returns 
 */
const _getPlanID = async (sm_url, token, offeringID) => {
    // Recheck the fieldQuery for catalog_name
    const supportedPlans = ["standard", "s3-standard"]
    for (const planName of supportedPlans) {
        LOG.debug('Fetching object store plan from Service Manager', { planName })
        try {
            const plan = await _serviceManagerRequest(
                sm_url,
                HTTP_METHOD.GET,
                PATH.SERVICE_PLAN,
                token,
                {
                    fieldQuery: `service_offering_id eq '${offeringID}' and catalog_name eq '${planName}'`,
                }
            )
            if (plan?.id) {
                LOG.debug('Using object store plan', { planName, planID: plan.id, offeringID })
                return plan.id
            }
        } catch (error) {
            LOG.error(`Failed to fetch plan "${planName}" from Service Manager`, error,
                'Check Service Manager connectivity and credentials',
                { sm_url, offeringID, planName })
            throw error
        }
    }
    LOG.debug('No supported object store service plan found in Service Manager', { sm_url, attempted: supportedPlans.join(", ") })
    throw new Error(
        `No supported object store service plan found in Service Manager.`
    )
}

/**
 * Creates an object store instance for the given tenant
 * @param {string} sm_url - Service Manager URL
 * @param {string} tenant - Tenant ID
 * @param {string} planID - Service Plan ID
 * @param {string} token  - OAuth token
 * @returns 
 */
const _createObjectStoreInstance = async (sm_url, tenant, planID, token) => {
    try {
        const response = await axios.post(`${sm_url}/v1/service_instances`, {
            name: `object-store-${tenant}-${cds.utils.uuid()}`,
            service_plan_id: planID,
            parameters: {},
            labels: { tenant_id: [tenant], service: ["OBJECT_STORE"] }
        }, {
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        })
        const instancePath = response.headers.location.substring(1)
        const instanceId = await _pollUntilDone(sm_url, instancePath, token)
        return instanceId.data.resource_id
    } catch (error) {
        LOG.error(`Failed to create object store instance for tenant - ${tenant}`, error,
            'Check Service Manager connectivity and credentials',
            { sm_url, tenant, planID })
    }
}

/**
 * Polls the service manager until the instance is in a terminal state
 * @param {string} sm_url - Service Manager URL
 * @param {string} instancePath - Path to the service instance
 * @param {string} token - OAuth token
 * @returns 
 */
const _pollUntilDone = async (sm_url, instancePath, token) => {
    try {
        let iteration = 1
        const startTime = Date.now()
        let isReady = false
        while (!isReady) {
            await wait(POLL_WAIT_TIME * iteration)
            iteration++

            const instanceStatus = await axios.get(`${sm_url}/${instancePath}`, {
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
            })

            if (instanceStatus.data.state === STATE.SUCCEEDED) {
                isReady = true
                return instanceStatus
            }

            if (Date.now() - startTime > ASYNC_TIMEOUT) {
                LOG.debug('Timed out waiting for service instance to be ready', { instancePath, sm_url })
            }

            if (instanceStatus.data.state === STATE.FAILED) {
                LOG.debug('Service instance creation failed', { instancePath, sm_url, details: instanceStatus.data })
            }
        }
    } catch (error) {
        LOG.error('Error polling for object store instance readiness', error,
            'Check Service Manager connectivity and instance status',
            { sm_url, instancePath })
    }
}

/**
 * Registers attachment handlers for the given service and entity
 * @param {string} sm_url - Service Manager URL
 * @param {string} tenant - Tenant ID
 * @param {string} instanceID - Service Instance ID
 * @param {string} token - OAuth token
 * @returns 
 */
const _bindObjectStoreInstance = async (sm_url, tenant, instanceID, token) => {
    if (instanceID) {
        try {
            const response = await axios.post(`${sm_url}/${PATH.SERVICE_BINDING}`, {
                name: `object-store-${tenant}-${cds.utils.uuid()}`,
                service_instance_id: instanceID,
                parameters: {},
                labels: { tenant_id: [tenant], service: ["OBJECT_STORE"] }
            }, {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            })
            return response.data.id
        } catch (error) {
            LOG.error(`Error binding object store instance for tenant - ${tenant}`, error,
                'Check Service Manager connectivity and credentials',
                { sm_url, tenant, instanceID })
        }
    }
}

/**
 * Registers attachment handlers for the given service and entity
 * @param {string} sm_url - Service Manager URL
 * @param {string} tenant - Tenant ID
 * @param {string} token - OAuth token
 * @returns {string} - Binding ID
 */
const _getBindingIdForDeletion = async (sm_url, tenant, token) => {
    try {
        const getBindingCredentials = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_BINDING, token, {
            labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenant}'`
        })
        if (!getBindingCredentials?.id) {
            LOG.warn('No binding credentials found for tenant during deletion', { tenant })
            return null // Handle missing data gracefully
        }
        return getBindingCredentials.id

    } catch (error) {
        LOG.error(`Error fetching binding credentials for tenant - ${tenant}`, error,
            'Check Service Manager connectivity and credentials',
            { sm_url, tenant })
    }
}

/**
 * Registers attachment handlers for the given service and entity
 * @param {string} sm_url - Service Manager URL
 * @param {string} bindingID - Binding ID
 * @param {string} token - OAuth token
 */
const _deleteBinding = async (sm_url, bindingID, token) => {
    if (bindingID) {
        try {
            await axios.delete(`${sm_url}/${PATH.SERVICE_BINDING}/${bindingID}`, {
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
            })
        } catch (error) {
            LOG.error(`Error deleting binding - ${bindingID}`, error,
                'Check Service Manager connectivity and credentials',
                { sm_url, bindingID })
        }
    } else {
        LOG.warn('No binding ID provided for deletion, skipping delete operation')
    }
}

/**
 * Registers attachment handlers for the given service and entity
 * @param {string} sm_url - Service Manager URL
 * @param {string} tenant - Tenant ID
 * @param {string} token - OAuth token
 * @returns {string} - Instance ID
 */
const _getInstanceIdForDeletion = async (sm_url, tenant, token) => {
    try {
        const instanceId = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_INSTANCE, token, { labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenant}'` })
        return instanceId.id
    } catch (error) {
        LOG.error(`Error fetching service instance id for tenant - ${tenant}`, error,
            'Check Service Manager connectivity and credentials',
            { sm_url, tenant })
    }
}

/**
 * Deletes an object store instance
 * @param {string} sm_url - Service Manager URL
 * @param {string} instanceID - Service Instance ID
 * @param {string} token - OAuth token
 */
const _deleteObjectStoreInstance = async (sm_url, instanceID, token) => {
    if (instanceID) {
        try {
            const response = await axios.delete(`${sm_url}/${PATH.SERVICE_INSTANCE}/${instanceID}`, {
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
            })
            const instancePath = response.headers.get("location").substring(1)
            await _pollUntilDone(sm_url, instancePath, token) // remove
            LOG.debug('Object store instance deleted', { instanceID })
        } catch (error) {
            LOG.error(
                `Error deleting object store instance - ${instanceID}`, error,
                'Check Service Manager connectivity and credentials',
                { sm_url, instanceID })
        }
    }
}

cds.on('listening', async () => {
    const profiles = cds.env.profiles ?? [cds.env.profile]
    const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind
    if (profiles.includes('mtx-sidecar') && cds.env.requires?.attachments?.kind !== 'db') {
        const ds = await cds.connect.to("cds.xt.DeploymentService")
        if (objectStoreKind === "separate") {
            ds.after('subscribe', async (_, req) => {
                const { tenant } = req.data
                try {
                    const serviceManagerCredentials = cds.env.requires?.serviceManager?.credentials || {}
                    validateServiceManagerCredentials(serviceManagerCredentials)
                    const { sm_url, url, clientid, clientsecret, certificate, key } = serviceManagerCredentials

                    const token = await _fetchToken(url, clientid, clientsecret, certificate, key)

                    const existingTenantBindings = await fetchObjectStoreBinding(tenant, token);

                    if (existingTenantBindings.length) {
                        LOG.info(`Existing tenant specific object store for ${tenant} exists. Skipping creation of new one.`)
                        return;
                    }

                    const offeringID = await _getOfferingID(sm_url, token)
                    const planID = await _getPlanID(sm_url, token, offeringID)

                    const instanceID = await _createObjectStoreInstance(sm_url, tenant, planID, token)
                    LOG.debug('Object Store instance created', { tenant, instanceID })

                    await _bindObjectStoreInstance(sm_url, tenant, instanceID, token)
                } catch (error) {
                    LOG.error(`Error setting up object store for tenant - ${tenant}`, error,
                        'Check Service Manager connectivity and credentials',
                        { tenant })
                }
            })

            ds.after('unsubscribe', async (_, req) => {
                const { tenant } = req.data
                try {
                    const serviceManagerCredentials = cds.env.requires?.serviceManager?.credentials || {}
                    validateServiceManagerCredentials(serviceManagerCredentials)

                    const { sm_url, url, clientid, clientsecret, certificate, key } = serviceManagerCredentials

                    const token = await _fetchToken(url, clientid, clientsecret, certificate, key)

                    const bindingID = await _getBindingIdForDeletion(sm_url, tenant, token)

                    await _deleteBinding(sm_url, bindingID, token)

                    const service_instance_id = await _getInstanceIdForDeletion(sm_url, tenant, token)

                    await _deleteObjectStoreInstance(sm_url, service_instance_id, token)
                } catch (error) {
                    LOG.error(
                        `Error deleting object store service for tenant - ${tenant}`, error,
                        'Check Service Manager connectivity and credentials',
                        { tenant })
                }

            })
        } else if (objectStoreKind === "shared") {
            ds.after('unsubscribe', async (_, req) => {
                const { tenant } = req.data

                const creds = cds.env.requires?.objectStore?.credentials
                if (!creds) throw new Error("SAP Object Store instance credentials not found.")

                switch (cds.env.requires?.attachments?.kind) {
                    case "s3":
                        await _cleanupAWSS3Objects(creds, tenant)
                        break
                    case "azure":
                        await _cleanupAzureBlobObjects(creds, tenant)
                        break
                    case "gcp":
                        await _cleanupGoogleCloudObjects(creds, tenant)
                        break
                    default:
                        LOG.warn('Unsupported object store kind for cleanup', { kind: cds.env.requires?.attachments?.kind, tenant })
                }
            })

        }
    }
    module.exports = cds.server
})

/**
 * Cleanup for AWS S3 objects for a given tenant
 * @param {*} creds - AWS S3 credentials
 * @param {string} tenant - Tenant ID
 */
const _cleanupAWSS3Objects = async (creds, tenant) => {
    const { S3Client, paginateListObjectsV2, DeleteObjectsCommand } = require('@aws-sdk/client-s3')
    const client = new S3Client({
        region: creds.region,
        credentials: {
            accessKeyId: creds.access_key_id,
            secretAccessKey: creds.secret_access_key,
        },
    })

    const bucket = creds.bucket
    const keysToDelete = []

    try {
        const paginator = paginateListObjectsV2({ client }, {
            Bucket: bucket,
            Prefix: tenant,
        })

        for await (const page of paginator) {
            page.Contents?.forEach(obj => {
                keysToDelete.push({ Key: obj.Key })
            })
        }

        if (keysToDelete.length > 0) {
            await client.send(new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: keysToDelete },
            }))
            LOG.debug('[AWS S3] S3 objects deleted for tenant', { tenant, deletedCount: keysToDelete.length })
        } else {
            LOG.debug('[AWS S3] No S3 objects found for tenant during cleanup', { tenant })
        }
    } catch (error) {
        LOG.error(
            `Failed to clean up S3 objects for tenant "${tenant}"`, error,
            'Check AWS S3 connectivity and permissions',
            { tenant })
    }
}

/**
 * Cleanup for Azure Blob Storage objects for a given tenant
 * @param {*} creds - Azure Blob Storage credentials
 * @param {string} tenant - Tenant ID
 */
const _cleanupAzureBlobObjects = async (creds, tenant) => {
    const { BlobServiceClient } = require('@azure/storage-blob')
    const blobServiceClient = new BlobServiceClient(`${creds.container_uri}?${creds.sas_token}`)
    const containerClient = blobServiceClient.getContainerClient(creds.container)

    try {
        const blobsToDelete = []
        for await (const blob of containerClient.listBlobsFlat({ prefix: tenant })) {
            blobsToDelete.push(blob.name)
        }

        for (const blobName of blobsToDelete) {
            const blockBlobClient = containerClient.getBlockBlobClient(blobName)
            await blockBlobClient.delete()
        }

        LOG.debug('[Azure] Azure Blob objects deleted for tenant', { tenant, deletedCount: blobsToDelete.length })
    } catch (error) {
        LOG.error(
            `Failed to clean up Azure Blob objects for tenant "${tenant}"`, error,
            'Check Azure Blob Storage connectivity and permissions',
            { tenant })
    }
}

/**
 * Cleanup for Google Cloud Storage objects for a given tenant
 * @param {*} creds - Google Cloud Storage credentials
 * @param {string} tenant - Tenant ID
 */
const _cleanupGoogleCloudObjects = async (creds, tenant) => {
    const { Storage } = require('@google-cloud/storage')
    const storageClient = new Storage({
        projectId: creds.project_id,
        credentials: creds.service_account
    })
    const bucket = storageClient.bucket(creds.bucket_name)

    try {
        let pageToken = undefined
        let totalDeleted = 0
        do {
            const [files, nextQuery] = await bucket.getFiles({
                prefix: tenant,
                maxResults: 1000, // or another reasonable batch size
                pageToken
            })

            const deletePromises = files.map(file => file.delete())
            await Promise.all(deletePromises)
            totalDeleted += files.length
            pageToken = nextQuery?.pageToken
        } while (pageToken)

        LOG.debug('[GCP] Google Cloud Storage objects deleted for tenant', { tenant, deletedCount: totalDeleted })
    } catch (error) {
        LOG.error(
            `Failed to clean up Google Cloud Platform objects for tenant "${tenant}"`, error,
            'Check Google Cloud Storage connectivity and permissions',
            { tenant })
    }
}

module.exports = {
    _fetchToken,
    _serviceManagerRequest,
    _getOfferingID,
    _getPlanID,
    _createObjectStoreInstance
}
