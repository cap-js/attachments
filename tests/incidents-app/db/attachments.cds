using {sap.capire.incidents as my} from './schema';
using {Attachments} from '@cap-js/attachments';

extend my.Incidents with {
  @Validation.MaxItems : 2
  @Validation.MinItems : 1
  attachments          : Composition of many Attachments;
  @attachments.disable_facet
  @Validation.MaxItems : (urgency.code = 'H' ? 2 : 3)
  hiddenAttachments    : Composition of many Attachments;

  @UI.Hidden
  hiddenAttachments2   : Composition of many Attachments;

  @UI.Hidden
  mediaTypeAttachments : Composition of many Attachments;
}

annotate my.Incidents.hiddenAttachments with {
  content @Validation.Maximum: '2MB';
}

annotate my.Incidents.mediaTypeAttachments with {
  content @Core.AcceptableMediaTypes: ['image/jpeg'];
}

@UI.Facets: [{
  $Type : 'UI.ReferenceFacet',
  Target: 'attachments/@UI.LineItem',
  Label : 'My custom attachments',
}]
extend my.Customers with {
  attachments : Composition of many Attachments;
}

extend my.SampleRootWithComposedEntity with {
  attachments : Composition of many Attachments;
}

extend my.Test with {
  attachments: Composition of many Attachments;
}

extend my.TestDetails with {
  attachments: Composition of many Attachments;
}

extend my.NonDraftTest with {
  attachments: Composition of many Attachments;
}

extend my.SingleTestDetails with {
  attachments : Composition of many Attachments;
}