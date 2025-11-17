const cds = require('@sap/cds')
const LOG = cds.log('attachments')
const { extname } = require("path")

const isMultitenacyEnabled = !!cds.env.requires.multitenancy
const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind

/**
 * Prepares the attachment data before creation
 * @param {import('@sap/cds').Request} req - The request object
 */
function onPrepareAttachment(req) {
  if (!req.target?._attachments.isAttachmentsEntity) return;
  
  req.data.url = isMultitenacyEnabled && objectStoreKind === "shared" 
    ? `${req.tenant}_${req.data.url}` 
    : cds.utils.uuid()
  req.data.ID ??= cds.utils.uuid()
  
  let ext = req.data.filename ? extname(req.data.filename).toLowerCase().slice(1) : null
  req.data.mimeType = Ext2MimeTypes[ext]
  if (!req.data.mimeType) {
    LOG.warn(`An attachment ${req.data.ID} is uploaded whose extension "${ext}" is not known! Falling back to "application/octet-stream"`)
    req.data.mimeType = "application/octet-stream"
  }
}

/**
 * Validates if the attachment can be accessed based on its malware scan status
 * @param {import('@sap/cds').Request} req - The request object
 */
async function validateAttachment(req) {
  if (!req.target?._attachments.isAttachmentsEntity) return;

  /* removing case condition for mediaType annotation as in our case binary value and metadata is stored in different database */
  req?.query?.SELECT?.columns?.forEach((element) => {
    if (element.as === 'content@odata.mediaContentType' && element.xpr) {
      delete element.xpr
      element.ref = ['mimeType']
    }
  })

  if (req?.req?.url?.endsWith("/content")) {
    const AttachmentsSrv = await cds.connect.to("attachments")
    const status = await AttachmentsSrv.getStatus(req.target, { ID: req.data.ID || req.params?.at(-1).ID })
    if (status === null || status === undefined) {
      return req.reject(404, 'Attachment not found')
    }
    const scanEnabled = cds.env.requires?.attachments?.scan ?? true
    if (scanEnabled && status !== 'Clean') {
      req.reject(403, 'Unable to download the attachment as scan status is not clean.')
    }
  }
}

/**
 * Reads the attachment content if requested
 * @param {[cds.Entity]} param0
 * @param {import('@sap/cds').Request} req - The request object
 */
async function readAttachment([attachment], req) {
  if (!req.target?._attachments.isAttachmentsEntity) return;

  const AttachmentsSrv = await cds.connect.to("attachments")
  if (req._.readAfterWrite || !req?.req?.url?.endsWith("/content") || !attachment || attachment?.content) return
  let keys = { ID: req.data.ID ?? req.params.at(-1).ID }
  let { target } = req
  attachment.content = await AttachmentsSrv.get(target, keys)
}

function validateAttachmentSize(req) {
  if (!req.target?._attachments.isAttachmentsEntity || !req.data.content) return;

  const contentLengthHeader = req.headers["content-length"]
  let fileSizeInBytes

  if (contentLengthHeader) {
    fileSizeInBytes = Number(contentLengthHeader)
    const MAX_FILE_SIZE = 419430400 //400 MB in bytes
    if (fileSizeInBytes > MAX_FILE_SIZE) {
      return req.reject(400, "File Size limit exceeded beyond 400 MB.")
    }
  } else {
    return req.reject(400, "Invalid Content Size")
  }
}



module.exports = {
  validateAttachmentSize,
  onPrepareAttachment,
  readAttachment,
  validateAttachment
}

// Supported mime types
const Ext2MimeTypes = {
  aac: "audio/aac",
  abw: "application/x-abiword",
  arc: "application/octet-stream",
  avi: "video/x-msvideo",
  azw: "application/vnd.amazon.ebook",
  bin: "application/octet-stream",
  png: "image/png",
  gif: "image/gif",
  bmp: "image/bmp",
  bz: "application/x-bzip",
  bz2: "application/x-bzip2",
  csh: "application/x-csh",
  css: "text/css",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odt: "application/vnd.oasis.opendocument.text",
  epub: "application/epub+zip",
  gz: "application/gzip",
  htm: "text/html",
  html: "text/html",
  ico: "image/x-icon",
  ics: "text/calendar",
  jar: "application/java-archive",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  mid: "audio/midi",
  midi: "audio/midi",
  mjs: "text/javascript",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpkg: "application/vnd.apple.installer+xml",
  otf: "font/otf",
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  rar: "application/x-rar-compressed",
  rtf: "application/rtf",
  svg: "image/svg+xml",
  tar: "application/x-tar",
  tif: "image/tiff",
  tiff: "image/tiff",
  ttf: "font/ttf",
  vsd: "application/vnd.visio",
  wav: "audio/wav",
  woff: "font/woff",
  woff2: "font/woff2",
  xhtml: "application/xhtml+xml",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  zip: "application/zip",
  txt: "application/txt",
  lst: "application/txt",
  webp: "image/webp",
}
