using { cuid, managed } from '@sap/cds/common';

type Image : Composition of sap.attachments.Images;
type Attachments : Composition of many sap.attachments.MyAttachments on docs.object = $self;


context sap.attachments {

  // Used in cds-plugin.js as template for attachments
  aspect aspect @(UI.Facets: [{
    $Type                : 'UI.ReferenceFacet',
    ID                   : 'AttachmentsFacet',
    Label                : '{i18n>Attachments}',
    Target               : 'attachments/@UI.PresentationVariant'
  }]) {
    attachments    : Association to many Attachments on attachments.parent = $self.ID;
    key ID  : UUID;
  }

  entity Images : cuid, managed, MediaData {}

entity MyAttachments: Attachments {
  object: Association to incidents.Incidents;
}

  entity Attachments : cuid, managed, MediaData {
      parent     : String;
      note       : String;
  }

   type MediaData {
    fileName : String;
    content   : LargeBinary @title: 'Attachment' @Core.MediaType: mimeType @Core.ContentDisposition.Filename: fileName @Core.Immutable: true;
    mimeType  : String @title: 'Attachment Type' @Core.IsMediaType: true;
    url       : String;
  }

  annotate AttachmentsTable with @(UI: {
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
      {Value: content},
      {Value: note}
    ],
    DeleteHidden       : true,
  });


}
