const cds = require("@sap/cds");
require('./lib/plugin')
if(cds.env.profile =='with-mtx-sidecar' && cds.env.requires.attachments.objectstore.kind=="separate"){
require('./lib/mtx/server')
}