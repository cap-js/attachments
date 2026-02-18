const { getAttachmentKind } = require("../lib/helper")
const LOG = require("@sap/cds").log("attachments")

LOG.info(`Using ${getAttachmentKind()} for attachments management.`)

module.exports = require(`./${getAttachmentKind()}`)
