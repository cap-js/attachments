const cds = require("@sap/cds/lib");
const LOG = cds.log("attachments");
const { extname } = require("path");
const DEBUG = LOG._debug ? LOG.debug : undefined;
const attachmentIDRegex = /attachments\(.*ID=([^,]+),.*\)/;

cds.on("loaded", function unfoldModel(csn) {
  if (!("Attachments" in csn.definitions)) return;
  const csnCopy = structuredClone(csn)
  cds.linked(csnCopy).forall("Composition", (comp) => {
    if (comp._target["@_is_media_data"] && comp.parent && comp.is2many) {
      const parentDefinition = comp.parent.name
      let facets = csn.definitions[parentDefinition]["@UI.Facets"];
      if (!facets) return;
      DEBUG?.("Adding @UI.Facet to:", comp.parent.name);
      facets.push({
        $Type: "UI.ReferenceFacet",
        Target: `${comp.name}/@UI.LineItem`,
        Label: "{i18n>Attachments}",
      });
    }
  });
});

cds.once("served", async function registerPluginHandlers() {
  if (!("Attachments" in cds.model.definitions)) return;

  const AttachmentsSrv = await cds.connect.to("attachments");

  // Searching all associations to attachments to add respective handlers
  for (let srv of cds.services) {
    if (srv instanceof cds.ApplicationService) {
      Object.values(srv.entities).forEach((entity) => {
        
        for (let elementName in entity.elements) {
          if (elementName === "SiblingEntity") continue; // REVISIT: Why do we have this?
          const element = entity.elements[elementName], target = element._target;
          if (target?.["@_is_media_data"] && target?.drafts) {
            DEBUG?.("serving attachments for:", target.name);
            
            srv.before("READ", [target, target.drafts], validateAttachment);

            srv.after("READ", [target, target.drafts], readAttachment);

            AttachmentsSrv.registerUpdateHandlers(srv, entity, target);
            
            srv.before('NEW', target.drafts, req => {
              req.data.url = cds.utils.uuid();
              req.data.ID = cds.utils.uuid();
              let ext = extname(req.data.filename).toLowerCase().slice(1);
              req.data.mimeType = Ext2MimeTyes[ext] || "application/octet-stream";
            });
          }
        }
      });
    }
  }

  async function validateAttachment(req) {
    
    /* removing case condition for mediaType annotation as in our case binary value and metadata is stored in different database */
    
    req?.query?.SELECT?.columns?.forEach((element) => {
      if(element.as === 'content@odata.mediaContentType' && element.xpr){
        delete element.xpr;
        element.ref = ['mimeType'];
      }
    });

    if(req?.req?.url?.endsWith("/content")) {
      const attachmentID = req.req.url.match(attachmentIDRegex)[1];
      const status = await AttachmentsSrv.getStatus(req.target, { ID : attachmentID });
      const scanEnabled = cds.env.requires?.attachments?.scan ?? true
      if(scanEnabled && status !== 'Clean') {
        req.reject(403, 'Unable to download the attachment as scan status is not clean.');
      }
    }
  }

  async function readAttachment([attachment], req) {
    if (!req?.req?.url?.endsWith("/content") || !attachment || attachment?.content) return;
    let keys = { ID : req.req.url.match(attachmentIDRegex)[1]};
    let { target } = req;
    attachment.content = await AttachmentsSrv.get(target, keys, req); //Dependency -> sending req object for usage in SDM plugin
  }
});

const Ext2MimeTyes = {
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
  lst: "application/txt"
};
