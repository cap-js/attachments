const cds = require("@sap/cds");
require('./lib/plugin')
console.log("Before mtx")
if(cds.env.requires.attachments.objectstore.kind=="separate")
require('./lib/mtx/server')
console.log("After mtx")