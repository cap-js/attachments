const cds = require("@sap/cds/lib")
const { extname } = require("path")
const { logConfig } = require('./logger')
const attachmentIDRegex = /\/\w+\(.*ID=([0-9a-fA-F-]{36})/

cds.on(cds.version >= "8.6.0" ? "compile.to.edmx" : "loaded", unfoldModel)

function unfoldModel(csn) {
  const meta = csn.meta ??= {}
  if (!("sap.attachments.Attachments" in csn.definitions)) return
  if (meta._enhanced_for_attachments) return
  // const csnCopy = structuredClone(csn) // REVISIT: Why did we add this cloning?
  const hasFacetForComp = (comp, facets) => facets.some(f => f.Target === `${comp.name}/@UI.LineItem` || (f.Facets && hasFacetForComp(comp, f.Facets)))
  cds.linked(csn).forall("Composition", (comp) => {
    if (comp._target && comp._target["@_is_media_data"] && comp.parent && comp.is2many) {
      let facets = comp.parent["@UI.Facets"]
      if (!facets) return
      if (comp["@attachments.disable_facet"] !== undefined) {
        logConfig.warn(`@attachments.disable_facet is deprecated! Please annotate ${comp.name} with @UI.Hidden`)
      }
      if (!comp["@attachments.disable_facet"] && !hasFacetForComp(comp, facets)) {
        logConfig.debug(`Adding @UI.Facet to: ${comp.parent.name}`)
        const attachmentsFacet = {
          $Type: "UI.ReferenceFacet",
          Target: `${comp.name}/@UI.LineItem`,
          ID: `${comp.name}_attachments`,
          Label: "{i18n>Attachments}",
        }
        if (comp["@UI.Hidden"]) {
          attachmentsFacet["@UI.Hidden"] = comp["@UI.Hidden"]
        }
        facets.push(attachmentsFacet)
      }

    }
  })
  meta._enhanced_for_attachments = true
}

cds.once("served", async function registerPluginHandlers() {
  if (!("sap.attachments.Attachments" in cds.model.definitions)) return
  const AttachmentsSrv = await cds.connect.to("attachments")
  // Searching all associations to attachments to add respective handlers
  for (let srv of cds.services) {
    if (srv instanceof cds.ApplicationService) {
      Object.values(srv.entities).forEach((entity) => {

        for (let elementName in entity.elements) {
          if (elementName === "SiblingEntity") continue // REVISIT: Why do we have this?
          const element = entity.elements[elementName], target = element._target

          if (!isAttachmentAnnotated(target)) continue
          const isDraft = !!target?.drafts
          const targets = isDraft ? [target, target.drafts] : [target]

          logConfig.debug(`Registering handlers for attachment entity: ${target.name}`)

          srv.before("READ", targets, validateAttachment)

          srv.after("READ", targets, readAttachment)

          if (isDraft) {
            srv.before("PUT", target.drafts, (req) => validateAttachmentSize(req))
            srv.before("NEW", target.drafts, (req) => onPrepareAttachment(req))
            AttachmentsSrv.registerDraftUpdateHandlers(srv, entity, target)
          } else {
            srv.before("PUT", target, (req) => validateAttachmentSize(req))
            srv.before("CREATE", target, (req) => onPrepareAttachment(req))
            AttachmentsSrv.registerUpdateHandlers(srv, entity, target)
          }
        }
      })
    }
  }

  /**
   * Prepares the attachment data before creation
   * @param {import('@sap/cds').Request} req - The request object
   */
  function onPrepareAttachment(req) {
    req.data.url = cds.utils.uuid()
    const isMultitenacyEnabled = !!cds.env.requires.multitenancy
    const objectStoreKind = cds.env.requires?.attachments?.objectStore?.kind
    if (isMultitenacyEnabled && objectStoreKind === "shared") {
      req.data.url = `${req.tenant}_${req.data.url}`
    }
    req.data.ID = cds.utils.uuid()
    let ext = extname(req.data.filename).toLowerCase().slice(1)
    req.data.mimeType = Ext2MimeTypes[ext] || "application/octet-stream"
  }

  /**
   * Validates if the attachment can be accessed based on its malware scan status
   * @param {import('@sap/cds').Request} req - The request object
   */
  async function validateAttachment(req) {

    /* removing case condition for mediaType annotation as in our case binary value and metadata is stored in different database */

    req?.query?.SELECT?.columns?.forEach((element) => {
      if (element.as === 'content@odata.mediaContentType' && element.xpr) {
        delete element.xpr
        element.ref = ['mimeType']
      }
    })

    if (req?.req?.url?.endsWith("/content")) {
      const attachmentID = req.req.url.match(attachmentIDRegex)[1]
      const status = await AttachmentsSrv.getStatus(req.target, { ID: attachmentID })
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
   * @returns
   */
  async function readAttachment([attachment], req) {
    if (req._.readAfterWrite || !req?.req?.url?.endsWith("/content") || !attachment || attachment?.content) return
    let keys = { ID: req.req.url.match(attachmentIDRegex)[1] }
    let { target } = req
    attachment.content = await AttachmentsSrv.get(target, keys)
  }
})

function validateAttachmentSize(req) {
  const contentLengthHeader = req.headers["content-length"]
  let fileSizeInBytes

  if (contentLengthHeader) {
    fileSizeInBytes = Number(contentLengthHeader)
    const MAX_FILE_SIZE = 419430400 //400 MB in bytes
    if (fileSizeInBytes > MAX_FILE_SIZE) {
      return req.reject(403, "File Size limit exceeded beyond 400 MB.")
    }
  } else {
    return req.reject(403, "Invalid Content Size")
  }
}

function isAttachmentAnnotated(target) {
  return !!target?.["@_is_media_data"]
}

module.exports = { validateAttachmentSize }

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
