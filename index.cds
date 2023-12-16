using { cuid, managed } from '@sap/cds/common';
namespace sap.common;

/** entity to store metadata about attachements  */
entity Attachments : cuid, managed {
  object   : String(111); // The object we are attached to
  filename : String;
  url      : String;
  mimeType : String
    @title: 'Attachment Type'
    @Core.IsMediaType: true;
  content  : LargeBinary
    @title: 'Attachment'
    @Core.MediaType: mimeType
    @Core.ContentDisposition.Filename: filename
    @Core.Immutable: true;
  note     : String
    @title: 'Note';
}

/** Shortcut for single images as to-one attachements */
type Image : Composition of Attachments;

// - Fiori Annotations ----------------------------------------------------------
annotate Attachments with @UI: {
  MediaResource: { Stream: content },
  LineItem: [
    {Value: content},
    {Value: createdAt},
    {Value: createdBy},
    {Value: note}
  ],
  DeleteHidden: true,
};
