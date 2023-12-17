using { sap.common.Image, sap.common.Attachments } from '@cap-js/attachments';
using { sap.capire.incidents as my } from '@capire/incidents/db/schema';

extend my.Customers with {
  avatar : Image;
}

extend my.Incidents with {
  attachments : Composition of many Attachments on attachments.object = $self.ID;
}
