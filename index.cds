using { managed } from '@sap/cds/common';
//using from './srv/attachments';

entity MediaData {
  type : String @Core.IsMediaType: true;
  url  : String @Core.IsURL @Core.MediaType: 'image/png';
  content: LargeBinary;
}

type Image : MediaData {
    fileName: String;
}

annotate Image with @(
    title: 'Attachments:Image',
    description: 'Type Image from @cap-js/attachments'
);
