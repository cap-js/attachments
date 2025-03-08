const cds = require('@sap/cds');
const axios = require('axios');
const xsenv = require('@sap/xsenv');

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

// 2️⃣ Make a Request to Service Manager (Reusable Function)
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
        console.log("Items data");
        // console.log(response.data)
        // console.log(response.data.items)
        console.log(response.data?.items[0]);
        return response.data?.items[0];
    } catch (error) {
        console.error(`Error fetching ${path}:`, error);
        throw error;
    }
};

// 3️⃣ Fetch Offering ID & Plan ID
const _getOfferingID = async (sm_url, token) => {
    const offerings = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_OFFERING, token, { fieldQuery: "name eq 'objectstore'" });
    const offeringID = offerings?.id;
    const offeringName = offerings?.name;
    console.log("Offering Id", `${offeringID}`);
    console.log("Offering Name", `${offeringName}`);
    if (!offeringID) throw new Error('Service offering not found');
    console.log("returning offering Id");
    return offeringID;
}

const _getPlanID = async(sm_url,token, offeringID)=>{
    console.log("Fetching Plan ID");
    const plans = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_PLAN, token, { fieldQuery: `service_offering_id eq '${offeringID}' and catalog_name eq 's3-standard'` });
    const planID = plans?.id;
    console.log("Printitng plan ID")
    console.log("Plan id", `${planID}`);
    if (!planID) throw new Error('Service plan not found');
    console.log("returning plan Id");
    return  planID;
 };

// 4️⃣ Create Object Store Instance
const _createObjectStoreInstance = async (sm_url, tenant, offeringID, planID, token) => {
    console.log("Inside object store instance creation");

    // Validate inputs
    if (!sm_url || !tenant || !offeringID || !planID || !token) {
        console.error("Error: Missing required parameters!");
        return;
    }

    try {
        console.log("Creating Object Store instance with:");
        console.log("Service Manager URL:", sm_url);
        console.log("Tenant:", tenant);
        console.log("Offering Id:", offeringID);
        console.log("Plan ID:", planID);

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

        console.log("Object Store instance created successfully");

        // Ensure response headers contain 'location'
        if (!response.headers.location) {
            console.error("Error: Location header missing in response!");
            throw new Error("Missing location header");
        }
        
        console.log("Response returning when object store instance has been created successfully", response.headers.location.substring(1));
        return response.headers.location.substring(1);

    } catch (error) {
        console.error("Error creating object store service instance:", error.response?.data || error.message);
        throw error;
    }
};


// 5️⃣ Poll for Instance Readiness
const _pollForInstanceReady = async (sm_url, instancePath, token) => {
    for (let i = 0; i < 10; i++) {
        const instanceStatus = await axios.get(`${sm_url}/${instancePath}`, {
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        if (instanceStatus.data.state === 'succeeded') {
            console.log('Instance is ready');
            return instanceStatus.data.resource_id;
        } else if (instanceStatus.data.state === 'failed') {
            throw new Error('Service instance creation failed');
        }

        console.log('Instance not ready, retrying...');
        await new Promise(resolve => setTimeout(resolve, 30000));
    }

    throw new Error('Service instance creation timed out');
};

// 6️⃣ Bind Object Store Instance
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
        console.log("Object Store instances is now binded")
        return response.data.id;
    } catch (error) {
        console.error('Error creating service binding:', error);
        throw error;
    }
};
//get Bindingcredential for tenant
const _getBindingIdForTenant = async (sm_url, tenant, token) => {

    try {
        const getBindingCredentials = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_BINDING, token, { labelQuery: `tenant_id eq '${tenant}'` });
        console.log("Binding credentials", getBindingCredentials.id);
        return getBindingCredentials.id;
    } catch (error) {
        console.error('Error fetching insatnce binding infromation:', error);
        throw error;
    }
}

// 7️⃣ Delete Binding
const _deleteBinding = async (sm_url, bindingID,tenant,token) => {
    try {
        await axios.delete(`${sm_url}/${PATH.SERVICE_BINDING}/${bindingID}`, {
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        console.log('Service binding deleted');
    } catch (error) {
        console.error('Error deleting binding:', error);
        throw error;
    }
};

//get service instance cred
const _getServiceInstanceId = async (sm_url, tenant, token) => {
    try {
        const instanceId = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_INSTANCE, token, { labelQuery: `tenant_id eq '${tenant}'` });
        console.log("Service Instance Id for deleting service", instanceId.id)
        return instanceId.id;
    } catch (error) {
        console.error('Error fetching the instance for deleting:', error);
        throw error;
    }
}

// 8️⃣ Delete Object Store Instance
const _deleteObjectStoreInstance = async (sm_url, instanceID, token) => {
    try {
        await axios.delete(`${sm_url}/${PATH.SERVICE_INSTANCE}/${instanceID}`, {
            headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
        });

        console.log('Service instance deleted');
    } catch (error) {
        console.error('Error deleting instance:', error);
        throw error;
    }
};

cds.on('listening', async () => {
    console.log("listening");
    const profile = cds.env.profile;
    console.log("Profile",`${profile}`);
    if (profile === 'mtx-sidecar') {
        console.log("Inside Profiel",profile);
        const ds = await cds.connect.to("cds.xt.DeploymentService");
        console.log("Connected to deployemnt service");
        // get service manager credentials
        const serviceManagerCredentials = xsenv.serviceCredentials({ label: 'service-manager' });
        console.log("serviceManagerCredentials:", serviceManagerCredentials);
        const { sm_url, url, clientid, clientsecret } = serviceManagerCredentials;

        // Fetch OAuth Token
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
        console.log(`Fetched token: ${token}`);

        //handlers
        ds.after('subscribe', async (_, req) => {
            console.log("Inside the after subscribe handler");
            const { tenant } = req.data;
            console.log(`Subscribing tenant ${tenant}`);
            try {
                console.log("Inside the try block");
                // Get Offering  ID
                const offeringID= await _getOfferingID(sm_url, token);

                const planID = await _getPlanID(sm_url,token,offeringID);

                // Create Instance
                const instancePath = await _createObjectStoreInstance(sm_url, tenant, offeringID, planID, token);

                // Poll for Readiness
                const instanceID = await _pollForInstanceReady(sm_url, instancePath, token);

                // Bind Instance
                await _bindObjectStoreInstance(sm_url, tenant, instanceID, token);
            } catch (error) {
                console.error("Error in object store instance creation process:", error);
            }
        });

        ds.after('unsubscribe', async (_, req) => {
            const { tenant } = req.data;
            console.log(`Unsubscribing tenant ${tenant}`);

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