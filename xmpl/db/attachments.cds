
using { sap.capire.incidents as my } from '@capire/incidents/db/schema';
using { sap.attachments.Attachments } from '@cap-js/attachments';

extend my.Incidents with {
  attachments: Composition of many Attachments;
}
