// Backup of original logger for testing
const cds = require('@sap/cds');

// Simple no-op logger for testing
const logConfig = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  verbose: () => {},
  configValidation: () => {},
  tokenFetch: () => {},
  s3Operation: () => {},
  fileOperation: () => {},
  malwareScan: () => {},
  processStep: () => {},
  withSuggestion: () => {}
};

module.exports = { logConfig };