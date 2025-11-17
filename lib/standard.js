const cds = require("@sap/cds")

module.exports = cds.env.requires?.objectStore?.credentials?.access_key_id
  ? require('./aws-s3')
  : cds.env.requires?.objectStore?.credentials?.container_name
    ? require('./azure-blob-storage')
    : cds.env.requires?.objectStore?.credentials?.projectId
      ? require('./gcp')
      : require('./aws-s3')