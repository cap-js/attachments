using { sap.capire.incidents as my } from '@capire/incidents/db/schema';
using { Image, Attachments } from '@cap-js/attachments';

extend my.Incidents with {
  attachments : Attachments;
}

extend my.Customers with {
  avatar : Image;
}
