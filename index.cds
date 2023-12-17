using { cuid, managed } from '@sap/cds/common';

/** entity to store metadata about attachements  */
entity sap.common.Attachments : cuid, managed {
  kind     : String(77);  // e.g. 'image', 'document', 'video', ...
  subject  : String(111); // The object we are attached to
  filename : String;
  url      : String;
  mimeType : String @title: 'Media Type';
  content  : LargeBinary @title: 'Attachment';
  note     : String @title: 'Note';
}

/** Shortcut for multiple attachments as to-many relationship to Attachments */
type Attachments : Composition of many sap.common.Attachments;
  // Note: on condition is filled in automatically

/** Shortcut for single image as to-one relationship to Attachments */
type Image : Composition of sap.common.Images;
// REVISIT: ^^^ should be: Composition of sap.common.Attachments;
// However, we cannot do so today because of a bug in @sap/cds' getDraftTreeRoot
// function which assumes a given entity can only show up in exactly one composition
// throughout the whole model.
// So we have to use this workaround for the time being:
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
} {
  mimeType @Core.IsMediaType: true;
  content @Core.MediaType: mimeType
    @Core.ContentDisposition.Filename: filename
    @Core.Immutable: true;
};
