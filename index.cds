using { cuid, managed } from '@sap/cds/common';

aspect MediaData @(_is_media_data) {
  url      : String;
  content  : LargeBinary @title: 'Attachment'; // only for db-based services
  mimeType : String @title: 'Media Type';
}

aspect Attachments : managed, MediaData {
  key filename : String @title: 'Filename';
  note         : String @title: 'Note';
}

entity sap.common.Images : cuid, MediaData {}
type Image : Composition of sap.common.Images;


// -- Fiori Annotations ----------------------------------------------------------

annotate MediaData with @UI.MediaResource: { Stream: content } {
  content  @Core.MediaType: mimeType @odata.draft.skip;
  mimeType @Core.IsMediaType;
}

annotate Attachments with @UI:{
  LineItem: [
    {Value: content}, // FIXME: by that we always read the content, even if not needed, as in attachments lists!
    {Value: createdAt},
    {Value: createdBy},
    {Value: note}
  ],
  // DeleteHidden,
} {
  content @Core:{ Immutable, ContentDisposition.Filename: filename }
}
