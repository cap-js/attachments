using { managed } from '@sap/cds/common';
using from './srv/obj-store';

// TODO: Keep names for 'Image' and 'Attachments'

type MediaData {
  type : String @Core.IsMediaType;
  url  : String @Core.IsURL;
}

entity Documents : managed, MediaData {
  object : String(36); //> the object we're attached to
  title  : String;
  key ID : UUID;
}

type Image : MediaData {
  ID : String;
}

type Attachments : Composition of many Documents;
