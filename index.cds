using { managed } from '@sap/cds/common';
using from './srv/attachments';

// TODO: Requests do not update OData Media Objects
entity MediaData {
  key ID : UUID;
  //imageType : String @Core.IsMediaType: true;
  imageUrl  : String //@Core.IsURL @Core.MediaType: imageType;
  //virtual content : LargeBinary @Core.MediaType: imageType;
}

entity Documents : managed, MediaData {
  object : String(36);
  title  : String;
  key ID : UUID;
}

type Image : MediaData {
  ID : String;
}

type Attachments : Composition of many Documents;
