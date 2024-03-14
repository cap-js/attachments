using { managed, cuid } from '@sap/cds/common';

aspect MediaData @(_is_media_data) {
  url      : UUID;
  content  : LargeBinary @title: 'Attachment'; // only for db-based services
  mimeType : String @title: 'Media Type' default 'application/octet-stream';
  filename : String @title: 'Filename';
  status :  String @title: 'Status' enum {
    UNSCANNED = 'Unscanned';
    UNDER_SCAN = 'Under Scan';
    MALWARE_DETECTED = 'Malware Detected';
    CLEAN = 'Clean';
    } default 'Unscanned';
}

aspect Attachments : managed, cuid, MediaData {
  note         : String @title: 'Note'; 
}

entity sap.common.Images : cuid,MediaData {
}
type Image : Composition of sap.common.Images;

// -- Fiori Annotations ----------------------------------------------------------

annotate MediaData with @UI.MediaResource: { Stream: content } {
  content @Core.MediaType: mimeType @odata.draft.skip;
  mimeType @Core.IsMediaType;
  status @readonly;
}

annotate Attachments with @UI:{
  LineItem: [
    {Value: content},
    {Value: status},
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
