using {sap.capire.incidents as my} from '../db/schema';
using from '../db/attachments';

/**
 * Service used by support personell, i.e. the incidents' 'processors'.
 */
service ProcessorService {
  @cds.redirection.target
  entity Incidents                    as projection on my.Incidents;

  entity Customers @readonly          as projection on my.Customers;

  @odata.draft.enabled
  entity SampleRootWithComposedEntity as projection on my.SampleRootWithComposedEntity;

  @odata.draft.enabled
  entity Test                         as projection on my.Test;

  entity TestDetails                  as projection on my.TestDetails;

  entity NonDraftTest                 as projection on my.NonDraftTest;

  entity SingleTestDetails            as projection on my.SingleTestDetails;
}

/**
 * Service used by administrators to manage customers and incidents.
 */
service AdminService {
  entity Customers as projection on my.Customers;
  entity Incidents as projection on my.Incidents;
}

service ValidationTestService {
  @odata.draft.enabled
  entity Incidents as projection on my.Incidents;

  annotate Incidents with {
    @Validation.MaxItems: 2
    @Validation.MinItems: 1
    attachments;
    hiddenAttachments    @Validation.MaxItems : (urgency.code = 'H' ? 2 : 3);
    hiddenAttachments2   @Validation.MinItems : (urgency.code = 'H' ? 1 : 0);
    mediaTypeAttachments @Validation.MaxItems : 2;
  };

  annotate Incidents.conversation with {
    @Validation.MaxItems: 2
    @Validation.MinItems: 1
    attachments;
  }
}

annotate ProcessorService.Incidents with @odata.draft.enabled;
annotate ProcessorService with @(requires: 'support');
annotate AdminService with @(requires: 'admin');
