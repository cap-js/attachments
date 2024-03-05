using { managed } from '@sap/cds/common';

aspect MediaData @(_is_media_data) {
  url      : String;
  content  : LargeBinary @title: 'Attachment'; // only for db-based services
  mimeType : String @title: 'Media Type' default 'application/octet-stream';
}

aspect Attachments : managed, MediaData {
  key filename : String @title: 'Filename';
  note         : String @title: 'Note';
}

entity sap.common.Images : MediaData {
  key ID : UUID;
  filename : String @title: 'Filename';
}
type Image : Composition of sap.common.Images;


// -- Fiori Annotations ----------------------------------------------------------

annotate MediaData with @UI.MediaResource: { Stream: content } {
  content @Core.MediaType: mimeType @odata.draft.skip;
  mimeType @Core.IsMediaType;
}

annotate Attachments with @UI:{
  LineItem: [
    {Value: content},
    {Value: createdAt},
    {Value: createdBy},
    {Value: note}
  ],
  // DeleteHidden,
} {
  content @Core:{ Immutable, ContentDisposition.Filename: filename, ContentDisposition.Type: 'inline' }
}

annotate sap.common.Images with {
  content @Core:{ Immutable, ContentDisposition.Filename: filename }
}
