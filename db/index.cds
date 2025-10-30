
// The common root-level aspect used in applications like that:
// using { Attachments } from '@cap-js/attachments'
aspect Attachments : sap.attachments.Attachments {}

using { managed, cuid, sap.common.CodeList } from '@sap/cds/common';
context sap.attachments {

  aspect MediaData @(_is_media_data) {
    url      : String;
    content  : LargeBinary @title: '{i18n>Attachment}'; // only for db-based services
    mimeType : String default 'application/octet-stream' @title: '{i18n>MediaType}';
    filename : String @title: '{i18n>FileName}';
    hash     : String @UI.Hidden @Core.Computed;
    status   : String @title: '{i18n>ScanStatus}' default 'Unscanned' @Common.Text : statusNav.name @Common.TextArrangement : #TextOnly;
    statusNav : Association to one ScanStates on statusNav.code = status;
  }

  entity ScanStates : CodeList {
    key code : String(32) @Common.Text : name @Common.TextArrangement : #TextOnly enum {
      Unscanned;
      Scanning;
      Infected;
      Clean;
      Failed;
    };
    name : localized String(64);
    criticality: Integer @UI.Hidden;
  }

  aspect Attachments : cuid, managed, MediaData {
    note : String @title: '{i18n>Note}';
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
      {Value: content, @HTML5.CssDefaults: {width: '30%'}},
      {Value: status, Criticality: statusNav.criticality, @HTML5.CssDefaults: {width: '10%'}},
      {Value: createdAt, @HTML5.CssDefaults: {width: '20%'}},
      {Value: createdBy, @HTML5.CssDefaults: {width: '15%'}},
      {Value: note, @HTML5.CssDefaults: {width: '25%'}}
    ]
  } {
    content
      @Core.ContentDisposition: { Filename: filename, Type: 'inline' }
  }

}