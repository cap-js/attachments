using { cuid, managed } from '@sap/cds/common';

entity MediaData {
  content  : LargeBinary;
  mimeType : String(500) @Core.IsMediaType: true;
  url      : String @Core.IsURL @Core.MediaType: mimeType;
}

type Image       : managed, MediaData {
  fileName        : String(255);
}

type Attachments : managed, MediaData {
  fileName        : String(255);
  fileDisplayName : String(255);
  fileDescription : LargeString;
  fileSize        : Integer;
  languageCode    : String;
  lastMalwareScan : Timestamp;
  readOnly        : Boolean;
}

context sap.attachments {
  /**
   * Used in cds-plugin.js as template for attachments
   */
  aspect aspect @(UI.Facets: [{
    $Type : 'UI.ReferenceFacet',
    ID    : 'AttachmentsFacet',
    Label : '{i18n>Attachments}',
    Target: 'attachments/@UI.PresentationVariant',
  //TODO: Use for lazy-loading once Fiori fixes bugs and v1.120 is released
  //![@UI.PartOfPreview]: false
  }]) {
    attachments : Association to many AttachmentsView
                    on attachments.entityKey = ID;
    key ID      : String;
  }

  view AttachmentsView as
    select from Attachments {
      *,
      attachmentslist.entityKey as entityKey,
    };


  @cds.autoexpose: true
  entity AttachmentsList : managed, cuid {
      entityKey   : UUID @title: '{i18n>Objects.entityKey}';
      attachments : Composition of many Attachments
                    on attachments.attachmentslist = $self;
  }

  entity Attachments {
    key ID              : UUID;
        fileName        : String;
        title           : String;
        object          : String;
        attachmentslist : Association to AttachmentsList;
  }

  annotate AttachmentsView with @(UI: {
    PresentationVariant: {Visualizations: ['@UI.LineItem'], },
    LineItem           : [
      { Value: fileName }
    ]
  });

}
