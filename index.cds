using { cuid, managed } from '@sap/cds/common';

/** entity to store metadata about attachements  */
entity sap.common.Attachments : cuid, managed {
  subject   : String(111); // The object we are attached to
  kind     : String(77);  // e.g. 'image', 'document', 'video', ...
  filename : String;
  url      : String;
  mimeType : String
    @title: 'Media Type'
    @Core.IsMediaType: true;
  content  : LargeBinary
    @title: 'Attachment'
    @Core.MediaType: mimeType
    @Core.ContentDisposition.Filename: filename
    @Core.Immutable: true;
  note     : String
    @title: 'Note';
}

/** Shortcut for multiple attachments as to-many relationship to Attachments */
type Attachments : Composition of many sap.common.Attachments;
  // Note: on condition is filled in automatically

/** Shortcut for single images as to-one relationship to Attachments */
// type Image : Composition of Attachments;
// REVISIT: We cannot use the above shortcut because of a bug in @sap/cds'
// getDraftTreeRoot function which assumes a given entity can only show up in
// exactly one composition throughout the whole model.
// So we have to use the following workaround for the time being:
type Image : Composition of sap.common.Images;
entity sap.common.Images as projection on sap.common.Attachments;


// - Fiori Annotations ----------------------------------------------------------
annotate sap.common.Attachments with @UI: {
  MediaResource: { Stream: content },
  LineItem: [
    {Value: content},
    {Value: createdAt},
    {Value: createdBy},
    {Value: note}
  ],
  DeleteHidden: true,
};
