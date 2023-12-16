using { sap.common.Image, sap.common.Attachments } from '@cap-js/attachments';
using { sap.capire.incidents as my } from '../app/services';


// Demonstrate how to use type 'Image'
extend my.Customers with {
  avatar : Image;
};

// Demonstrate how to use entity 'Attachments'
extend my.Incidents with {
  attachments : Composition of many Attachments on attachments.object = $self.ID;
};


// -- UI Annotations -----------------------------------------------------------

annotate ProcessorService.Incidents with @(UI.HeaderInfo: {
  TypeImageUrl: customer.avatar.url
});

// TODO: Can we pull these two annnotations back into the attachments library
// and add them dynamically (on cds boostrap)?
annotate ProcessorService.Incidents with @(UI.Facets: [ ..., {
  $Type : 'UI.ReferenceFacet', Target: 'attachments/@UI.LineItem',
  Label : '{i18n>Attachments}',
}]);
