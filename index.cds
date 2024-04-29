using { managed, cuid } from '@sap/cds/common';

aspect MediaData @(_is_media_data) {
  url      : String;
  content  : LargeBinary @title: 'Attachment'; // only for db-based services
  mimeType : String @title: 'Media Type' default 'application/octet-stream';
  filename : String @title: 'Filename';
  status   :  String @title: 'Scan Status' enum {
    Unscanned;
    Scanning;
    Infected;
    Clean;
    Failed;
  } default 'Unscanned';
}

aspect Attachments : managed, cuid, MediaData {
  note : String @title: 'Note';
}


// -- Fiori Annotations ----------------------------------------------------------

annotate MediaData with @UI.MediaResource: { Stream: content } {
  content  @Core.MediaType: mimeType @odata.draft.skip;
  mimeType @Core.IsMediaType;
  status @readonly;
}

annotate Attachments with @UI:{
  HeaderInfo: {
    TypeName: '{i18n>Attachment}',
    TypeNamePlural: '{i18n>Attachments}',
  },
  LineItem: [
    {Value: content},
    {Value: status},
    {Value: createdAt},
    {Value: createdBy},
    {Value: note}
  ]
} {
  content
    @Core.ContentDisposition: { Filename: filename, Type: 'inline' }
    @Core.Immutable
}
