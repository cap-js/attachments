using { cuid, managed } from '@sap/cds/common';

type Image: Association to sap.attachments.Images;
type Document: Association to sap.attachments.Documents;

context sap.attachments {

  @cds.autoexpose
  entity Images: managed, MediaData {
    key ID   : UUID;
    fileName : String;
  }

  entity Documents : managed, MediaData {
    key ID : UUID;
    title  : String;
    object : String(36); //> the object we're attached to
  }

  entity MediaData {
    content  : LargeBinary;
    // FIXME: Why is there an annotation error on @Core.IsURL?
    url      : String @Core.IsURL: true @Core.MediaType: mimeType;
    mimeType : String @Core.IsMediaType: true;
  }

  /**
   * Used in cds-plugin.js as template for attachments
   */
  // aspect aspect @(UI.Facets: [{
  //   $Type : 'UI.ReferenceFacet',
  //   ID    : 'AttachmentsFacet',
  //   Label : '{i18n>Attachments}',
  //   Target: 'resources/@UI.PresentationVariant',
  // //TODO: Use for lazy-loading once Fiori fixes bugs and v1.120 is released
  // //![@UI.PartOfPreview]: false
  // }]) {
  //   resources : Association to many sap.attachments.ResourceView
  //                   on resources.ID = ID;
  //   key ID   : String;
  // }

  // entity Resources : managed {
  //   key ID: UUID;
  //   fileName: String;
  // }

  // view ResourceView as
  //   select from Documents, Images {
  //     Documents.ID as DocumentID,
  //     Images.ID as ImageID
  //     //attachmentslist.entityKey as entityKey
  //   };

  // annotate ResourceView with @(UI: {
  //   PresentationVariant: { Visualizations: ['@UI.LineItem'] },
  //   LineItem           : [
  //     { Value: DocumentID },
  //     { Value: ImageID }
  //   ]
  // });

}
