// This is just to wire up the enhanced ProcessorService implementation
// in this monorepo setup. It is not required in a real-world project.

const cds = require("@sap/cds");
cds.once("served", () => require('./content/init').prototype.init.call(cds.services.ProcessorService))