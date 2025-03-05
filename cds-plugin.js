//const cds = require("@sap/cds");
require('./lib/plugin')
console.log("Before mtx")
require('./lib/mtx/server')
console.log("After mtx")