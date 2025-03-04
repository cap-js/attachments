const cds = require('@sap/cds');
const axios = require('axios');
const xsenv = require('@sap/xsenv');
const { to } = require('@sap/cds/lib/srv/cds-connect');

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

// 1️⃣ Get Service Manager Credentials
// const _getServiceCredentials = () => {
//     return {
//         sm_url: "https://service-manager.cfapps.eu12.hana.ondemand.com",
//         url: "https://captivator-nbdmhzkp.authentication.eu12.hana.ondemand.com",
//         clientid: "sb-7c552287-6356-446d-8367-5926be69edc9!b530507|service-manager!b3",
//         clientsecret: "f1927319-83c7-46da-b7f8-c45ecfd12363$XOqAfHMOv-iXeEJkomBYDWLgrdhAxluPDlQdlkLqmB0=",
//         xsappname: "7c552287-6356-446d-8367-5926be69edc9!b530507|service-manager!b3"
//     };
// };

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
        return response.data.items;
    } catch (error) {
        console.error(`Error fetching ${path}:`, error);
        throw error;
    }
};

// 3️⃣ Fetch Offering ID & Plan ID
const _getOfferingAndPlanID = async (sm_url, token) => {
    const offerings = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_OFFERING, token, { fieldQuery: "name eq 'objectstore'" });
    const offeringID = offerings[0]?.id;
    const offeringName = offerings[0]?.name;
    console.log("Offering Id", `${offeringID}`);
    console.log("Offering Name", `${offeringName}`);
    if (!offeringID) throw new Error('Service offering not found');

    const plans = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_PLAN, token, { fieldQuery: `service_offering_id eq '${offeringID}' and catalog_name eq 's3-standard'` });
    const planID = plans.data.items[0]?.id;
    console.log("Plan id", `${planID}`);
    if (!planID) throw new Error('Service plan not found');

    return { offeringName, planID };
};

// 4️⃣ Create Object Store Instance
const _createObjectStoreInstance = async (sm_url, tenant, offeringName, planID, token) => {
    try {
        const response = await axios.post(`${sm_url}/${PATH.SERVICE_INSTANCE}`, {
            name: `object-store-${tenant}-${cds.utils.uuid()}`,
            service_offering_name: offeringName,
            service_plan_name: planID,
            parameters: {},
            labels: { tenant_id: [tenant], service: ["OBJECT_STORE"] }
        }, {
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        console.log("Object store instance created");
        return response.headers.location.substring(1);
    } catch (error) {
        console.error('Error creating service instance:', error);
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
        console.log("Binding credentials", getBindingCredentials[0].id);
        return getBindingCredentials[0].id;
    } catch (error) {
        console.error('Error fetching insatnce binding infromation:', error);
        throw error;
    }
}

// 7️⃣ Delete Binding
const _deleteBinding = async (sm_url, bindingID, token) => {
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
        const instanceId = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.PATH.SERVICE_INSTANCE, token, { labelQuery: `tenant_id eq '${tenant}'` });
        console.log("Service Instance Id for deleting service", instanceId[0].id)
        return instanceId[0].id;
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
    const ds = await cds.connect.to("cds.xt.DeploymentService");

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
        const { tenant } = req.data;
        console.log(`Subscribing tenant ${tenant}`);
        try {

            cds.on('subscri')
            // Get Offering & Plan ID
            const { offeringID, planID } = await _getOfferingAndPlanID(sm_url, token);

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

    module.exports = cds.server;
});