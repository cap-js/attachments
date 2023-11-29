using { cuid, managed } from '@sap/cds/common';

type Image : Composition of sap.attachments.Images;

context sap.attachments {

  entity Images : cuid, managed, MediaData {}

  entity Attachments : cuid, managed, MediaData {
    object : UUID;
    note      : String @title: 'Note';
  }

  type MediaData {
    fileName : String;
    content   : LargeBinary @title: 'Attachment' @Core.MediaType: mimeType @Core.ContentDisposition.Filename: fileName @Core.Immutable: true;
    mimeType  : String @title: 'Attachment Type' @Core.IsMediaType: true;
    url       : String;
  }

}
