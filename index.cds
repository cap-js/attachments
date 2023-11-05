using { cuid, managed } from '@sap/cds/common';

type Image: Association to sap.attachments.Images;
type Document: Association to sap.attachments.Documents;

context sap.attachments {

  @cds.autoexpose
  entity Images: managed, MediaData {
    key ID   : UUID;
    fileName : String;
  }

  entity Documents : managed, MediaData {
    key ID : UUID;
    title  : String;
    object : String(36); //> the object we're attached to
  }

  entity MediaData {
    content  : LargeBinary;
    // FIXME: Why is there an annotation error on @Core.IsURL?
    url      : String @Core.IsURL: true @Core.MediaType: mimeType;
    mimeType : String @Core.IsMediaType: true;
  }
}