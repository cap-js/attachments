using { sap.capire.incidents as my } from '@capire/incidents/app/services';
using { Image, Attachments } from '@cap-js/attachments';

extend my.Incidents with { attachments: Attachments }
extend my.Customers with { avatar: Image }


// -- Fiori Elements Annotations ------------------------------------------------

annotate ProcessorService.Incidents with @(UI.HeaderInfo: {
  TypeImageUrl: customer.avatar.url
});
