const cds = require("@sap/cds/lib");
const LOG = cds.log("attachments");
const { extname } = require("path");
const DEBUG = LOG._debug ? LOG.debug : undefined;

cds.on("loaded", function UnfoldModel(csn) {
  if ("Attachments" in csn.definitions);
  else return;
  cds.linked(csn).forall("Composition", (comp) => {
    if (comp._target["@_is_media_data"] && comp.parent && comp.is2many) {
      let Facets = comp.parent["@UI.Facets"];
      if (!Facets) return;
      DEBUG?.("Adding @UI.Facet to:", comp.parent.name);
      Facets.push({
        $Type: "UI.ReferenceFacet",
        Target: `${comp.name}/@UI.LineItem`,
        Label: "{i18n>Attachments}",
      });
    }
  });
});

cds.once("served", async function PluginHandlers() {
  if ("Attachments" in cds.model.definitions);
  else return;
  const AttachmentsSrv = await cds.connect.to("attachments");

  // Tagging sap.common.Images and all derivates of it
  cds.model.definitions["sap.common.Images"]._is_images = true;

  // Searching all associations to attachments to add respective handlers
  for (let srv of cds.services) {
    if (srv instanceof cds.ApplicationService) {
      Object.values(srv.entities).forEach((entity) => {
        let any = 0;
        for (let e in entity.elements) {
          if (e === "SiblingEntity") continue; // REVISIT: Why do we have this?
          const element = entity.elements[e],
            target = element._target;
          if (target?.["@_is_media_data"]) {
            DEBUG?.("serving attachments for:", target.name);
            if (cds.requires.attachments.kind != "db") {
              const handler = target._is_images ? ReadImage : ReadAttachment;
              for (let each of [target, target.drafts])
                if (each) srv.after("READ", each, handler);
              srv.after("DELETE", entity, DeleteAttachmentsAfterDelete);
              srv.before("UPDATE", entity, AttachDeletionData);
              srv.after("UPDATE", entity, DeleteAttachmentsAfterUpdate);
            }
            // srv.on ("NEW", entity, AddAttachmentHandler(element))
            srv.after("SAVE", entity, DraftSaveHandler4(element));
            any++;
          }
        }
        // Add handler to render image urls in objec pages
        if (any) srv.after("READ", entity, AddImageUrl);
      });
    }
  }

  async function AddImageUrl(results, req) {
    if (results.length !== 1) return;
    // Add image urls
    // TODO: Generalize this by rewriting getElementsOfType() function according to simplified model
    const imageElements = [["customer", "avatar"]];
    const [result] = results;
    for (const element of imageElements) {
      const [k, v] = element;
      if (result[k]) {
        const ID = result[k].ID;
        if (!result[k][v]) result[k] = Object.assign(result[k], { [v]: {} });
        const baseUrl = req?.req?.baseUrl || "http://localhost:4004";
        const baseEntity =
          cds.model.definitions[req.entity].elements[k].target.split(".")[1];
        const url = `${baseUrl}/${baseEntity}(${ID})/${v}/$value`;
        result[k][v].url = url;
        result[k][v]["url@results.mediaReadLink"] = url;
      }
    }
  }

  async function DeleteAttachment(key) {
    if (!key) return;
    return await AttachmentsSrv.delete(key);
  }

  async function DeleteAttachmentsAfterDelete(records, attachment) {
    let ObjectsToBeDeleted = await AttachmentsSrv.list(attachment.data.ID);
    ObjectsToBeDeleted.Contents.forEach((object) => {
      DeleteAttachment(object.Key);
    });
  }

  async function AttachDeletionData(data) {
    const diffData = await data.diff();
    let deletedAttachments = [];
    diffData.attachments
      .filter((object) => {
        return object._op == "delete";
      })
      .map((attachment) => {
        deletedAttachments.push(attachment.up__ID + "/" + attachment.filename);
      });
    data.deletedAttachments = deletedAttachments;
  }

  async function DeleteAttachmentsAfterUpdate(data) {
    data.deletedAttachments.map((key) => {
      DeleteAttachment(key);
    });
  }

  async function ReadImage([attachment], req) {
    if (!req._path?.endsWith("$value")) return;
    if (!attachment.content) {
      let keys = { ID: req.params.at(-1) };
      attachment.content = await AttachmentsSrv.get(req.target, keys);
    }
  }

  async function ReadAttachment([attachment], req) {
    if (!req._path?.endsWith("content")) return;
    if (!attachment.content && req.target.isDraft) {
      // if not found, read attachment from active data...
      let keys = req.params.at(-1);
      attachment.content = await AttachmentsSrv.get(req.target.actives, keys);
    } else {
      let keys = req.params.at(-1);
      attachment.content = await AttachmentsSrv.get(req.target, keys);
    }
  }

  /**
   * Returns a handler to copy updated attachments content from draft to active / object store
   */
  function DraftSaveHandler4(composition) {
    const Attachments = composition._target;
    const queryFields = getFields(Attachments);
    return async (_, req) => {
      // The below query loads the attachments into streams
      const attachments = await SELECT(queryFields)
        .from(Attachments.drafts)
        .where([
          ...req.subject.ref[0].where.map((x) =>
            x.ref ? { ref: ["up_", ...x.ref] } : x
          ),
          "and",
          { ref: ["content"] },
          "is not null", // NOTE: needs skip LargeBinary fix to Lean Draft
        ]);
      //check for mimetype if not there assign it as octet-stream;
      attachments.map((a) => {
        if (!a.mimeType) {
          let ext = extname(a.filename).toLowerCase().slice(1);
          a.mimeType = Ext2MimeTyes[ext] || "application/octet-stream";
        }
      });
      if (attachments.length)
        await AttachmentsSrv.put(Attachments, attachments);
    };
  }

  function getFields(Attachments) {
    const attachmentFields = ["filename", "mimeType", "content"];
    let { up_ } = Attachments.keys;
    if (up_)
      return up_.keys
        .map((k) => "up__" + k.ref[0])
        .concat(...attachmentFields)
        .map((k) => ({ ref: [k] }));
    else return Object.keys(Attachments.keys);
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
  lst: "application/txt",
};
