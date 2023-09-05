using { managed } from '@sap/cds/common';
using from './srv/attachments';

// TODO: Elaborate with MediaData
// entity MediaData {
//   key ID : UUID;
//   imageType : String @Core.IsMediaType: true;
//   imageUrl  : String @Core.IsURL @Core.MediaType: imageType;
// }

// entity Documents : managed, MediaData {
//   object : String(36);
//   title  : String;
//   key ID : UUID;
// }

//type Attachments : Composition of many Documents;

// QUESTION: Why is @Core.IsURL highlighted by CDS annotations?
type Image : String @Core.IsURL @Core.MediaType : 'image/png';
