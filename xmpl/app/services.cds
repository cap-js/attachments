using from '@capire/incidents/app/services';
using from '../db/schema';

annotate ProcessorService.Incidents with @(UI.HeaderInfo: {
  TypeImageUrl: customer.avatar.url
});

// TODO: Can we pull these two annnotations back into the attachments library
// and add them dynamically (on cds boostrap)?
annotate ProcessorService.Incidents with @(UI.Facets: [ ..., {
  $Type : 'UI.ReferenceFacet', Target: 'attachments/@UI.LineItem',
  Label : '{i18n>Attachments}',
}]);
