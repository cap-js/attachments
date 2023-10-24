using { managed } from '@sap/cds/common';
//using from './srv/attachments';

// TODO: Elaborate with MediaData
// entity MediaData {
//   key ID : UUID;
//   type : String @Core.IsMediaType: true;
//   url  : String @Core.IsURL @Core.MediaType: type;
// }

// entity Documents : managed, MediaData {
//   object : String(36);
//   title  : String;
//   key ID : UUID;
// }

//type Attachments : Composition of many Documents;
type Image : String @Core.IsURL @Core.MediaType : 'image/png';

annotate Image with @(
    title: 'Attachments:Image',
    description: 'Type Image from @cap-js/attachments'
);