const cds = require('@sap/cds');
const axios = require('axios');
const https = require("https");
const DEBUG = cds.debug('attachments');
const { S3Client, paginateListObjectsV2, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

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

        return response?.data?.items?.[0]; // Error handling : return undefined instead of crashing when .items is undefined

    } catch (error) {
        DEBUG?.(`Error fetching data from service manager: ${error.message}`);
    }
};

const _validateSMCredentials = ({ sm_url, url, clientid, clientsecret, certificate, key }) => {
  if (!sm_url || !url) {
    throw new Error("Missing Service Manager credentials: 'sm_url' or 'url' is not defined.");
  }

  if (!clientid || !clientsecret) {
    DEBUG?.("Client credentials not found. Falling back to MTLS if certificate and key are provided.");
    if (!certificate || !key) {
      throw new Error("MTLS credentials are also missing: 'certificate' or 'key' is not defined.");
    }
  }
};

const _fetchToken = async (url, clientid, clientsecret, certificate, key) => {
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
      const agent = new https.Agent({ cert: certificate, key: key });

      const response = await axios.post(tokenUrl, body, {
        headers,
        httpsAgent: agent,
      });
      return response.data.access_token;
    }

    // If neither flow is possible
    throw new Error("Missing authentication credentials: Provide either OAuth clientid/clientsecret or MTLS certificate/key.");
  } catch (error) {
    DEBUG?.(`Error fetching token from service manager: ${error.message}`);
    throw error;
  }
};

const _getOfferingID = async (sm_url, token) => {
    const offerings = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_OFFERING, token, { fieldQuery: "name eq 'objectstore'" });
    const offeringID = offerings.id;
    if (!offeringID) DEBUG?.('Object store service offering not found');
    return offeringID;
}

const _getPlanID = async (sm_url, token, offeringID) => {
  // Recheck the fieldQuery for catalog_name
  const supportedPlans = ["standard", "s3-standard"];
  for (const planName of supportedPlans) {
    try {
      const plan = await _serviceManagerRequest(
        sm_url,
        HTTP_METHOD.GET,
        PATH.SERVICE_PLAN,
        token,
        {
          fieldQuery: `service_offering_id eq '${offeringID}' and catalog_name eq '${planName}'`,
        }
      );
      if (plan?.id) {
        DEBUG?.(`Using object store plan "${planName}" with ID: ${plan.id}`);
        return plan.id;
      }
    } catch (error) {
      DEBUG?.(`Failed to fetch plan "${planName}": ${error.message}`);
    }
  }
  DEBUG?.(
    `No valid object store plan found (attempted: ${supportedPlans.join(", ")})`
  );
  throw new Error(
    `No supported object store service plan found in Service Manager.`
  );
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
        const instancePath = response.headers.location.substring(1);
        const instanceId = await _pollUntilDone(sm_url, instancePath, token);
        return instanceId.data.resource_id;
    } catch (error) {
        DEBUG?.(`Error creating object store instance - ${tenant}: ${error.message}`);
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
                return instanceStatus;
            }

            if (Date.now() - startTime > ASYNC_TIMEOUT) {
                DEBUG?.('Timed out waiting for service instance to be ready');
            }

            if (instanceStatus.data.state === STATE.FAILED) {
                DEBUG?.('Service instance creation failed');
            }
        }
    } catch (error) {
        DEBUG?.(`Error polling for object store instance readiness: ${error.message}`);
    }
};

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
            });
            return response.data.id;
        } catch (error) {
            DEBUG?.(`Error binding object store instance for tenant - ${tenant}: ${error.message}`);
        }
    }
};

const _getBindingIdForDeletion = async (sm_url, tenant, token) => {
    try {
        const getBindingCredentials = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_BINDING, token, {
            labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenant}'`
        });
        if (!getBindingCredentials?.id) {
            DEBUG?.("No binding credentials found!");
            return null; // Handle missing data gracefully
        }
        return getBindingCredentials.id;

    } catch (error) {
        DEBUG?.(`Error fetching binding credentials for tenant - ${tenant}: ${error.message}`);
    }
};

const _deleteBinding = async (sm_url, bindingID, token) => {
    if (bindingID) {
        try {
            await axios.delete(`${sm_url}/${PATH.SERVICE_BINDING}/${bindingID}`, {
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
            });
        } catch (error) {
            DEBUG?.('Error deleting binding:', error.message);
        }
    } else {
        DEBUG?.("Binding id is either undefined or null");
    }
};

const _getInstanceIdForDeletion = async (sm_url, tenant, token) => {
    try {
        const instanceId = await _serviceManagerRequest(sm_url, HTTP_METHOD.GET, PATH.SERVICE_INSTANCE, token, { labelQuery: `service eq 'OBJECT_STORE' and tenant_id eq '${tenant}'` });
        return instanceId.id;
    } catch (error) {
        DEBUG?.(`Error fetching service instance id for tenant - ${tenant}: ${error.message}`);
    }
}

const _deleteObjectStoreInstance = async (sm_url, instanceID, token) => {
    if (instanceID) {
        try {
            const response = await axios.delete(`${sm_url}/${PATH.SERVICE_INSTANCE}/${instanceID}`, {
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` }
            });
            const instancePath = response.headers.get("location").substring(1);
            await _pollUntilDone(sm_url, instancePath, token); // remove
            DEBUG?.('Object Store instance deleted');
        } catch (error) {
            DEBUG?.(`Error deleting object store instance - ${instanceID}: ${error.message}`);
        }
    }
};

cds.on('listening', async () => {
    const profile = cds.env.profile;
    const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind;
    if (profile === 'mtx-sidecar') {
        const ds = await cds.connect.to("cds.xt.DeploymentService");
        if (objectStoreKind === "separate") {
            ds.after('subscribe', async (_, req) => {
                const { tenant } = req.data;
                try {
                    const serviceManagerCredentials = cds.env.requires?.serviceManager?.credentials || {};
                    const { sm_url, url, clientid, clientsecret, certificate, key } = serviceManagerCredentials;

                    _validateSMCredentials({ sm_url, url, clientid, clientsecret, certificate, key });

                    const token = await _fetchToken(url, clientid, clientsecret, certificate, key)

                    const offeringID = await _getOfferingID(sm_url, token);

                    const planID = await _getPlanID(sm_url, token, offeringID);

                    const instanceID = await _createObjectStoreInstance(sm_url, tenant, planID, token);
                    DEBUG?.('Object Store instance created');

                    await _bindObjectStoreInstance(sm_url, tenant, instanceID, token);
                } catch (error) {
                    // eslint-disable-next-line no-console
                    console.error(`Error setting up object store for tenant - ${tenant}: ${error.message}`);
                }
            });

            ds.after('unsubscribe', async (_, req) => {
                const { tenant } = req.data;
                try {
                    const serviceManagerCredentials = cds.env.requires?.serviceManager?.credentials || {};
                    const { sm_url, url, clientid, clientsecret, certificate, key } = serviceManagerCredentials;

                    _validateSMCredentials({ sm_url, url, clientid, clientsecret, certificate, key });

                    const token = await _fetchToken(url, clientid, clientsecret, certificate, key);

                    const bindingID = await _getBindingIdForDeletion(sm_url, tenant, token);

                    await _deleteBinding(sm_url, bindingID, token);

                    const service_instance_id = await _getInstanceIdForDeletion(sm_url, tenant, token);

                    await _deleteObjectStoreInstance(sm_url, service_instance_id, token);
                } catch (error) {
                    // eslint-disable-next-line no-console
                    console.error(`Error deleting object store service for tenant - ${tenant}: ${error.message}`);
                }

            });
        } else if (objectStoreKind === "shared") {
            ds.after('unsubscribe', async (_, req) => {
                const { tenant } = req.data;

                const creds = cds.env.requires?.objectStore?.credentials;
                if (!creds) throw new Error("SAP Object Store instance credentials not found.");

                const client = new S3Client({
                    region: creds.region,
                    credentials: {
                        accessKeyId: creds.access_key_id,
                        secretAccessKey: creds.secret_access_key,
                    },
                });

                const bucket = creds.bucket;
                const keysToDelete = [];

                try {
                    const paginator = paginateListObjectsV2({ client }, {
                        Bucket: bucket,
                        Prefix: tenant,
                    });

                    for await (const page of paginator) {
                        page.Contents?.forEach(obj => {
                            keysToDelete.push({ Key: obj.Key });
                        });
                    }

                    if (keysToDelete.length > 0) {
                        await client.send(new DeleteObjectsCommand({
                            Bucket: bucket,
                            Delete: { Objects: keysToDelete },
                        }));
                        console.debug(`S3 objects deleted for tenant: ${tenant}`);
                    } else {
                        console.debug(`No S3 objects found for tenant: ${tenant}`);
                    }
                } catch (error) {
                    console.error(`Failed to clean up S3 objects for tenant "${tenant}": ${error.message}`);
                }
            });

        }
    }
    module.exports = cds.server;
});
