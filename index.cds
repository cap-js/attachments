using { cuid, managed } from '@sap/cds/common';

type Image : Composition of sap.attachments.Images;
type Attachments : Association to sap.attachments.Attachments;

context sap.attachments {

  // Used in cds-plugin.js as template for attachments
  aspect aspect @(UI.Facets: [{
    $Type                : 'UI.ReferenceFacet',
    ID                   : 'AttachmentsFacet',
    Label                : '{i18n>Attachments}',
    Target               : 'attachments/@UI.PresentationVariant',
    //![@UI.PartOfPreview] : false
  }]) {
    // Essentially: Association to many Attachments on attachments.attachmentslist.object = ID;
    attachments    : Association to many AttachmentsView
                     on attachments.entityKey = ID;
    key ID  : UUID;
  }

  // This is a helper view to flatten the assoc path to the objectKey
  view AttachmentsView as
    select from Documents {
      *,
      attachments.entityKey as entityKey
     };

  entity Images : cuid, managed, MediaData {
        fileName : String;
  }

  entity Documents : cuid, managed, MediaData {
        fileName    : String;
        title       : String;
        attachments : Association to Attachments;
  }

  entity Attachments : cuid, managed {
    entityKey : UUID @odata.Type:'Edm.String';
    createdAt : managed:createdAt @title: 'On';
    createdBy : managed:createdBy @title: 'By';
    documents : Composition of many Documents
                on documents.attachments = $self;
  }

  type MediaData {
    //FIXME: Having @Core.IsURL: true  @Core.MediaType generates
    // strange url strings ending with /url instead of /content
    content  : LargeBinary @Core.MediaType: mimeType;
    url      : String; // @Core.IsURL: true  @Core.MediaType: mimeType;
    mimeType : String  @Core.IsMediaType: true;
  }

  annotate AttachmentsView with @(UI: {
    MediaResource: {
      Stream: content
    },
    PresentationVariant: {
      Visualizations: ['@UI.LineItem'],
      SortOrder     : [{
        Property  : createdAt,
        Descending: true
      }],
    },
    LineItem: [
      {Value: createdAt},
      {Value: createdBy},
      {Value: fileName},
      {Value: title},
      {Value: content},
      {Value: entityKey}
    ],
    DeleteHidden       : true,
  });

}
