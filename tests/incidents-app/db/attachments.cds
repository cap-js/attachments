
using { sap.capire.incidents as my } from './schema';
using { Attachments } from '@cap-js/attachments';

extend my.Incidents with {
  
  attachments: Composition of many Attachments;
  @attachments.disable_facet
  attachments2: Composition of many Attachments;
 
}