const cds = require('@sap/cds')
const LOG = cds.log('attachments')
const { extname } = require("path")
const { MAX_FILE_SIZE, sizeInBytes, checkMimeTypeMatch } = require('./helper')

const isMultitenacyEnabled = !!cds.env.requires.multitenancy
const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind

/**
 * Prepares the attachment data before creation
 * @param {import('@sap/cds').Request} req - The request object
 */
async function onPrepareAttachment(req) {
  if (!req.target?._attachments.isAttachmentsEntity) return;

  const hasUpKey = Object.keys(req.data).some(key => key.startsWith("up__"))

  if (!hasUpKey) {
    let mySubject = { ...req.subject, ref: req.subject.ref.slice(0, -1) }
    const parentKeys = Object.keys(cds.infer.target({SELECT: {from: mySubject}}).keys)
    const parentRecord = await SELECT.one.from(mySubject).columns(parentKeys)
    
    for (const key of parentKeys) {
      req.data[`up__${key}`] = parentRecord[key]
    }
  }

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
      return req.reject(404)
    }
    const scanEnabled = cds.env.requires?.attachments?.scan ?? true
    if (scanEnabled && status !== 'Clean') {
      req.reject(403, 'UnableToDownloadAttachmentScanStatusNotClean')
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

/**
 * Checks the attachments size against the maximum defined by the annotation `@Validation.Maximum`. Default 400mb.
 * If the limit is reached by the reported size of the content-length header or if the stream length exceeds 
 * the limits the error is thrown.
 * @param {import('@sap/cds').Request} req - The request object
 * @throws AttachmentSizeExceeded 
 */
function validateAttachmentSize(req) {
  if (!req.target?._attachments.isAttachmentsEntity || !req.data.content) return;

  const maxFileSize = req.target.elements['content']['@Validation.Maximum'] ?
    sizeInBytes(req.target.elements['content']['@Validation.Maximum'], req.target.name) ?? MAX_FILE_SIZE :
    MAX_FILE_SIZE

  if (req.headers["content-length"] == null || req.headers["content-length"] === "") {
    return req.reject(400, 'ContentLengthHeaderMissing')
  }

  if (isNaN(Number(req.headers["content-length"]))) {
    return req.reject(400, 'InvalidContentLengthHeader', { contentLength: req.headers["content-length"] })
  }

  if (Number(req.headers["content-length"]) > maxFileSize) {
    if (req.data.content.pause) { req.data.content.pause() }
    return req.reject({ status: 413, message: "AttachmentSizeExceeded", args: [req.target.elements['content']['@Validation.Maximum'] ?? '400MB'] })
  }
}

/**
 * Validates the attachment mime type against acceptable media types
 * @param {import('@sap/cds').Request} req - The request object
 */
function validateAttachmentMimeType(req) {
  if (!req.target?._attachments.isAttachmentsEntity || !req.data.content) return;

  const mimeType = req.data.mimeType

  const acceptableMediaTypes = req.target.elements.content['@Core.AcceptableMediaTypes'] || '*/*'
  if (!checkMimeTypeMatch(acceptableMediaTypes, mimeType)) {
    return req.reject(400, "AttachmentMimeTypeDisallowed", { mimeType: mimeType })
  }
}

module.exports = {
  validateAttachmentSize,
  onPrepareAttachment,
  readAttachment,
  validateAttachment,
  validateAttachmentMimeType
}

// Mapping table from file extensions to mime types
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
