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

const LABEL = {
    OBJECT_STORE: "object-store"
};

//  Make a Request to Service Manager (Reusable Function)
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

        if (!response.data || !response.data.items || response.data.items.length === 0) {
            DEBUG?.(`No items found in response from ${path}`);
            return null; // Return null to avoid crashes
        }

        return response.data?.items[0]; // Return the first item safely

    } catch (error) {
        DEBUG?.(`Error fetching ${path}:`, error.response?.data || error.message);
        throw error;
    }
};


// Fetch OAuth Token
const _fetchToken = async (url, clientid, clientsecret) => {
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
    const token = tokenResponse.data.access_token;
    DEBUG?.(
        "Successfully fetched the token"
      );
    return token;
};


//  Fetch Offering ID & Plan ID
const _getOfferingID = async (sm_url, token) => {
    const offerings = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_OFFERING, token, { fieldQuery: "name eq 'objectstore'" });
    const offeringID = offerings?.id;
    const offeringName = offerings?.name;
    if (!offeringID) throw new Error('Service offering not found');
    DEBUG?.("returning offering Id");
    return offeringID;
}

const _getPlanID = async (sm_url, token, offeringID) => {
    DEBUG?.("Fetching Plan ID");
    const plans = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_PLAN, token, { fieldQuery: `service_offering_id eq '${offeringID}' and catalog_name eq 's3-standard'` });
    const planID = plans?.id;
    if (!planID) throw new Error('Service plan not found');
    DEBUG?.("returning plan Id");
    return planID;
};

//  Create Object Store Instance
const _createObjectStoreInstance = async (sm_url, tenant, offeringID, planID, token) => {

    // Validate inputs
    if (!sm_url || !tenant || !offeringID || !planID || !token) {
        DEBUG?.("Error: Missing required parameters!");
        return;
    }

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

        DEBUG?.("Object Store instance created successfully");

        // Ensure response headers contain 'location'
        if (!response.headers.location) {
            DEBUG?.("Error: Location header missing in response!");
            throw new Error("Missing location header");
        }
        return response.headers.location.substring(1);

    } catch (error) {
        DEBUG?.("Error creating object store service instance:", error.response?.data || error.message);
        throw error;
    }
};


//  Poll for Instance Readiness
const _pollForInstanceReady = async (sm_url, instancePath, token) => {
    for (let i = 0; i < 10; i++) {
        const instanceStatus = await axios.get(`${sm_url}/${instancePath}`, {
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        if (instanceStatus.data.state === 'succeeded') {
            DEBUG?.('Instance is ready');
            return instanceStatus.data.resource_id;
        } else if (instanceStatus.data.state === 'failed') {
            throw new Error('Service instance creation failed');
        }

        DEBUG?.('Instance not ready, retrying...');
        await new Promise(resolve => setTimeout(resolve, 30000));
    }

    throw new Error('Service instance creation timed out');
};

//  Bind Object Store Instance
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
        DEBUG?.("Object Store instances is now binded")
        return response.data.id;
    } catch (error) {
        DEBUG?.('Error creating service binding:', error);
        throw error;
    }
};
//get Bindingcredential for tenant
const _getBindingIdForTenant = async (sm_url, tenant, token) => {
    try {
        const getBindingCredentials = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_BINDING, token, {
            labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenant}'`
        });

        if (!getBindingCredentials || !getBindingCredentials.id) {
            DEBUG?.("No binding credentials found!");
            return null; // Handle missing data gracefully
        }
        return getBindingCredentials.id;

    } catch (error) {
        DEBUG?.("Error fetching instance binding information:", error);
        throw error;
    }
};

//  Delete Binding
const _deleteBinding = async (sm_url, bindingID, tenant, token) => {
    if (bindingID) {
        try {
            await axios.delete(`${sm_url}/${PATH.SERVICE_BINDING}/${bindingID}`, {
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
            });

            DEBUG?.('Service binding deleted');
        } catch (error) {
            DEBUG?.('Error deleting binding:', error);
            throw error;
        }
    } else {
        DEBUG?.("Binding id is either undefined or null");
    }
};

//get service instance cred
const _getServiceInstanceId = async (sm_url, tenant, token) => {
    try {
        const instanceId = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_INSTANCE, token, { labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenant}'` });
        return instanceId.id;
    } catch (error) {
        DEBUG?.('Error fetching the instance for deleting:', error);
        throw error;
    }
}

// Delete Object Store Instance
const _deleteObjectStoreInstance = async (sm_url, instanceID, token) => {
    if (instanceID) {
        try {
            await axios.delete(`${sm_url}/${PATH.SERVICE_INSTANCE}/${instanceID}`, {
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
            });

            DEBUG?.('Service instance deleted');
        } catch (error) {
            DEBUG?.('Error deleting instance:', error);
            throw error;
        }
    } else {
        DEBUG?.("Instance id is either undefined or null");
    }
};

cds.on('listening', async () => {
    const profile = cds.env.profile;
    DEBUG?.("Profile", `${profile}`);
    if (profile === 'mtx-sidecar') {
        const ds = await cds.connect.to("cds.xt.DeploymentService");
        DEBUG?.("Connected to deployemnt service");

        //handlers
        ds.after('subscribe', async (_, req) => {
            const { tenant } = req.data;
            DEBUG?.(`Subscribing tenant ${tenant}`);
            try {
                //fetching service manager credentials
                const serviceManagerCredentials = cds.env.requires.serviceManager.credentials;
                const { sm_url, url, clientid, clientsecret } = serviceManagerCredentials;

                //fetch token
                const token = await _fetchToken(url, clientid, clientsecret)
                // Get Offering  ID
                const offeringID = await _getOfferingID(sm_url, token);

                const planID = await _getPlanID(sm_url, token, offeringID);

                // Create Instance
                const instancePath = await _createObjectStoreInstance(sm_url, tenant, offeringID, planID, token);

                // Poll for Readiness
                const instanceID = await _pollForInstanceReady(sm_url, instancePath, token);

                // Bind Instance
                await _bindObjectStoreInstance(sm_url, tenant, instanceID, token);
            } catch (error) {
                DEBUG?.("Error in object store instance creation process:", error);
            }
        });

        ds.after('unsubscribe', async (_, req) => {
            const { tenant } = req.data;
            DEBUG?.(`Unsubscribing tenant ${tenant}`);
            //fetching service manager credentials
            const serviceManagerCredentials = cds.env.requires.serviceManager.credentials;
            const { sm_url, url, clientid, clientsecret } = serviceManagerCredentials;

            //fetch token
            const token = await _fetchToken(url, clientid, clientsecret)

            //get binding credentials
            const bindingID = await _getBindingIdForTenant(sm_url, tenant, token);

            // Delete Binding
            await _deleteBinding(sm_url, bindingID, tenant, token);

            //getting service instance credentials
            const service_instance_id = await _getServiceInstanceId(sm_url, tenant, token);

            // Delete Instance
            await _deleteObjectStoreInstance(sm_url, service_instance_id, token);

        });
    }
    module.exports = cds.server;
});