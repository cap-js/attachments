using { sap.capire.incidents as my } from './schema';
using { Attachments } from './../../index';

extend my.Incidents with {
  attachments: Composition of many Attachments;
}
