using {sap.capire.incidents as my} from '../db/schema';
using from '../db/attachments';

/**
 * Service used by support personell, i.e. the incidents' 'processors'.
 */
service ProcessorService {
  @cds.redirection.target
  entity Incidents                    as projection on my.Incidents actions {
    action copyIncident() returns Incidents;
  };

  entity Customers @readonly          as projection on my.Customers;

  @odata.draft.enabled
  entity SampleRootWithComposedEntity as projection on my.SampleRootWithComposedEntity;

  @odata.draft.enabled
  entity Test                         as projection on my.Test;

  entity TestDetails                  as projection on my.TestDetails;

  entity NonDraftTest                 as projection on my.NonDraftTest;

  entity SingleTestDetails            as projection on my.SingleTestDetails;

  @odata.draft.enabled
  entity Posts as projection on my.Posts;

  entity Comments as projection on my.Comments;

  @odata.draft.enabled
  entity Level0 as projection on my.Level0;

  entity Level0Notes as projection on my.Level0Notes;
  entity Level1 as projection on my.Level1;
  entity Level1Tags as projection on my.Level1Tags;
  entity Level2 as projection on my.Level2;
  entity Level3 as projection on my.Level3;

  action insertTestData() returns String;
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

service ValidationTestNonDraftService {
  entity Incidents as projection on my.Incidents;

  annotate Incidents with {
    @Validation.MaxItems: 2
    @Validation.MinItems: 1
    attachments;
    hiddenAttachments    @Validation.MaxItems : (urgency.code = 'H' ? 2 : 3);
    hiddenAttachments2   @Validation.MinItems : 1;
    mediaTypeAttachments @Validation.MaxItems : 2;
  };

  annotate Incidents.conversation with {
    @Validation.MaxItems: 2
    @Validation.MinItems: 1
    attachments;
  }
}

service RestrictionService {
  @(restrict: [{
    grant: '*',
    to   : 'admin',
    where: 'title = ''ABC'''
  }])
  entity Incidents     as projection on my.Incidents;

  @(restrict: [{
    grant: '*',
    to   : 'admin',
    where: 'title = ''ABC'''
  }])
  @odata.draft.enabled
  @cds.redirection.target
  entity DraftIcidents as projection on my.Incidents;
}

annotate ProcessorService.Incidents with @odata.draft.enabled;
annotate ProcessorService with @(requires: 'support');
annotate AdminService with @(requires: 'admin');
