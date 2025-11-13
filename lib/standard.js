const cds = require('@sap/cds');
const {log} = require('console');

log(cds.env.requires?.objectStore ? Object.keys(cds.env.requires?.objectStore) : 'Object store empty')
log(Object.keys(cds.env.requires?.objectStore?.credentials))
// REVISIT: Check if another flag allows hyper-scaler distinction
module.exports = cds.env.requires?.objectStore?.credentials?.access_key_id 
  ? require('./aws-s3')
  : cds.env.requires?.objectStore?.credentials?.container_name
    ? require('./azure-blob-storage')
    : cds.env.requires?.objectStore?.credentials?.projectId
      ? require('./gcp')
      : require('./aws-s3')
