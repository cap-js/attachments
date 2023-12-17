using { sap.capire.incidents as my } from '@capire/incidents/db/schema';
using { sap.common as cds } from '@cap-js/attachments';

extend my.Incidents with {
  attachments : Composition of many cds.Attachments;
  // Note: on condition is filled in automatically
}

extend my.Customers with {
  avatar : cds.Image;
}
