using { sap.common.Image, sap.common.Attachments } from '@cap-js/attachments';
using { sap.capire.incidents } from '../app/services';


// Demonstrate how to use type 'Image'
extend incidents.Customers with {
  avatar : Image;
};
annotate ProcessorService.Incidents with @(UI.HeaderInfo: {
  TypeImageUrl: customer.avatar.url
});

// Demonstrate how to use entity 'Attachments'
extend incidents.Incidents with {
  attachments : Composition of many Attachments on attachments.object = $self.ID;
};


// TODO: Can we pull these two annnotations back into the attachments library
// and add them dynamically (on cds boostrap)?
annotate ProcessorService.Incidents with @(UI.Facets: [ ..., {
  $Type : 'UI.ReferenceFacet', Target: 'attachments/@UI.LineItem',
  Label : '{i18n>Attachments}',
}]);
