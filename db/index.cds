// The common root-level aspect used in applications like that:
// using { Attachments } from '@cap-js/attachments'
aspect Attachments : sap.attachments.Attachments {}
type Attachment : sap.attachments.Attachment;

using {
  managed,
  cuid,
  sap.common.CodeList
} from '@sap/cds/common';

context sap.attachments {

  type Attachment @(_is_media_data) {
    url       : String                                    @UI.Hidden;
    content   : LargeBinary                               @title: '{i18n>Attachment}' @Core.MediaType: 'application/octet-stream'; // only for db-based services
    mimeType  : String default 'application/octet-stream' @title: '{i18n>MediaType}';
    filename  : String                                    @title: '{i18n>FileName}';
    hash      : String                                    @UI.Hidden                  @Core.Computed;
    status    : String default 'Unscanned'                @title: '{i18n>ScanStatus}' @readonly;
    lastScan  : Timestamp                                 @title: '{i18n>LastScan}'   @Core.Computed  @readonly;
  }

  aspect MediaData : Attachment {
    statusNav : Association to one ScanStates
                  on statusNav.code = status;
  }

  entity ScanStates : CodeList {
    key code        : String(32)           @Common.Text: name  @Common.TextArrangement: #TextOnly  enum {
          Unscanned;
          Scanning;
          Infected;
          Clean;
          Failed;
        };
        name        : localized String(64) @title: '{i18n>ScanStatus}';
        criticality : Integer              @UI.Hidden;
  }

  aspect Attachments : cuid, managed, MediaData {
    note : String  @title: '{i18n>Note}'  @UI.MultiLineText;
  }

  annotate Attachments with @Capabilities.UpdateRestrictions.NonUpdateableProperties : [
    content
  ];


  // -- Fiori Annotations ----------------------------------------------------------

  annotate MediaData with @UI.MediaResource: {Stream: content} {
    content  @Core.MediaType: mimeType  @odata.draft.skip;
    mimeType @Core.IsMediaType;
    status   @Common.Text: statusNav.name  @Common.TextArrangement: #TextOnly;
  }

  annotate Attachments with  @UI: {
    HeaderInfo: {
      TypeName      : '{i18n>Attachment}',
      TypeNamePlural: '{i18n>Attachments}',
    },
    LineItem  : [
      {
        Value             : content
      },
      {
        Value             : status,
        Criticality       : statusNav.criticality
      },
      {
        Value             : createdAt
      },
      {
        Value             : createdBy
      },
      {
        Value             : note
      }
    ],
  }  @Capabilities: {SortRestrictions: {NonSortableProperties: [content]}}  {
    content
    @Core.ContentDisposition: {
      Filename: filename,
      Type    : 'inline'
    }
  }

}
