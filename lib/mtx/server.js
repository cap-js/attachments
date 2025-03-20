const cds = require('@sap/cds');
const axios = require('axios');
const DEBUG = cds.debug('attachments');

const PATH = {
    SERVICE_INSTANCE: "v1/service_instances",
    SERVICE_BINDING: "v1/service_bindings",
    SERVICE_PLAN: "v1/service_plans",
    SERVICE_OFFERING: "v1/service_offerings"
};

const HTTP_METHOD = {
    POST: "post",
    GET: "get",
    DELETE: "delete"
};

const STATE = {
    SUCCEEDED: "succeeded",
    FAILED: "failed",
};

let POLL_WAIT_TIME = 5000;
const ASYNC_TIMEOUT = 5 * 60 * 1000;

async function wait(milliseconds) {
    if (milliseconds <= 0) {
        return;
    }
    await new Promise(function (resolve) {
        setTimeout(resolve, milliseconds);
    });
}

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
        });

        return response.data.items[0];

    } catch (error) {
        throw error(`Error fetching data from service manager: ${error}`); 
    }
};

const _fetchToken = async (url, clientid, clientsecret) => {
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

        return tokenResponse.data.access_token;
    } catch (error) {
        throw error(`Error fetching token from service manager: ${error}`); 
    }
};

const _getOfferingID = async (sm_url, token) => {
    const offerings = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_OFFERING, token, { fieldQuery: "name eq 'objectstore'" });
    const offeringID = offerings.id;
    if (!offeringID) throw new Error('Service offering not found');
    return offeringID;
}

const _getPlanID = async (sm_url, token, offeringID) => {
    // recheck the fieldQuery for catalog_name
    const plans = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_PLAN, token, { fieldQuery: `service_offering_id eq '${offeringID}' and catalog_name eq 's3-standard'` });
    const planID = plans.id;
    if (!planID) throw new Error('Service plan not found');
    return planID;
};

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
        });

        // const instanceID = _pollUntilDone();
        // return instanceID;
        return response.headers.location.substring(1);

    } catch (error) {
        throw error(`Error creating object store instance - ${tenant}: ${error}`);
    }
};

const _pollUntilDone = async (sm_url, instancePath, token) => {
    try {
        let iteration = 1;
        const startTime = Date.now();
        let isReady = false;
        while (!isReady) {
            await wait(POLL_WAIT_TIME * iteration);
            iteration++;

            const instanceStatus = await axios.get(`${sm_url}/${instancePath}`, {
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
            });

            if (instanceStatus.data.state === STATE.SUCCEEDED) {
                isReady = true;
                return instanceStatus.data.resource_id;
            }

            if (Date.now() - startTime > ASYNC_TIMEOUT) {
                throw new Error('Timed out waiting for service instance to be ready');
            }

            if (instanceStatus.data.state === STATE.FAILED) {
                throw new Error('Service instance creation failed');
            }
        }
    } catch (error) {
        throw error(`Error polling for object store instance readiness: ${error}`);
    }
};

const _bindObjectStoreInstance = async (sm_url, tenant, instanceID, token) => {
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
        });
        // _pollUntilDone();
        return response.data.id;
    } catch (error) {
        throw error(`Error binding object store instance for tenant - ${tenant}: ${error}`);
    }
};

const _getBindingIdForDeletion = async (sm_url, tenant, token) => {
    try {
        const getBindingCredentials = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_BINDING, token, {
            labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenant}'`
        });

        return getBindingCredentials.id;

    } catch (error) {
        throw error(`Error fetching binding credentials for tenant - ${tenant}: ${error}`);
    }
};

const _deleteBinding = async (sm_url, bindingID, token) => {
    try {
        await axios.delete(`${sm_url}/${PATH.SERVICE_BINDING}/${bindingID}`, {
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        // _pollUntilDone();
    } catch (error) {
        throw error(`Error deleting binding - ${bindingID}: ${error}`);
    }
};

const _getInstanceIdForDeletion = async (sm_url, tenant, token) => {
    try {
        const instanceId = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_INSTANCE, token, { labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenant}'` });
        return instanceId.id;
    } catch (error) {
        throw error(`Error fetching service instance id for tenant - ${tenant}: ${error}`);
    }
}

const _deleteObjectStoreInstance = async (sm_url, instanceID, token) => {
    try {
        await axios.delete(`${sm_url}/${PATH.SERVICE_INSTANCE}/${instanceID}`, {
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        DEBUG?.('Object Store instance deleted');
    } catch (error) {
        throw error(`Error deleting object store instance - ${instanceID}: ${error}`);
    }
};

cds.on('listening', async () => {
    const profile = cds.env.profile;
    if (profile === 'mtx-sidecar') {
        const ds = await cds.connect.to("cds.xt.DeploymentService");

        ds.after('subscribe', async (_, req) => {
            const { tenant } = req.data;
            try {
                const serviceManagerCredentials = cds.env.requires.serviceManager.credentials;
                const { sm_url, url, clientid, clientsecret } = serviceManagerCredentials;

                const token = await _fetchToken(url, clientid, clientsecret)

                const offeringID = await _getOfferingID(sm_url, token);

                const planID = await _getPlanID(sm_url, token, offeringID);

                const instancePath = await _createObjectStoreInstance(sm_url, tenant, planID, token); // change var to instanceID
                DEBUG?.('Object Store instance created');

                const instanceID = await _pollUntilDone(sm_url, instancePath, token); // remove

                await _bindObjectStoreInstance(sm_url, tenant, instanceID, token);
            } catch (error) {
                throw error(`Error setting up object store for tenant - ${tenant}: ${error}`);
            }
        });

        ds.after('unsubscribe', async (_, req) => {
            const { tenant } = req.data;
            try {
                const serviceManagerCredentials = cds.env.requires.serviceManager.credentials;
                const { sm_url, url, clientid, clientsecret } = serviceManagerCredentials;
    
                const token = await _fetchToken(url, clientid, clientsecret)
    
                const bindingID = await _getBindingIdForDeletion(sm_url, tenant, token);
    
                await _deleteBinding(sm_url, bindingID, token);
    
                const service_instance_id = await _getInstanceIdForDeletion(sm_url, tenant, token);
    
                await _deleteObjectStoreInstance(sm_url, service_instance_id, token);
            } catch (error) {
                throw error(`Error deleting object store instance for tenant - ${tenant}: ${error}`);
            }

        });
    }
    module.exports = cds.server;
});