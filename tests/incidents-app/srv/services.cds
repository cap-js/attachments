using { sap.capire.incidents as my } from '../db/schema';

/**
 * Service used by support personell, i.e. the incidents' 'processors'.
 */
service ProcessorService {
  @cds.redirection.target
  entity Incidents as projection on my.Incidents;

  entity Customers @readonly as projection on my.Customers;
  
  @odata.draft.enabled
  entity SampleRootWithComposedEntity as projection on my.SampleRootWithComposedEntity;

  @odata.draft.enabled
  entity Test as projection on my.Test;

  entity TestDetails as projection on my.TestDetails;

  entity NonDraftTest as projection on my.NonDraftTest;

  entity SingleTestDetails as projection on my.SingleTestDetails;
}

/**
 * Service used by administrators to manage customers and incidents.
 */
service AdminService {
  entity Customers as projection on my.Customers;
  entity Incidents as projection on my.Incidents;
}

service RestrictionService {
  @(restrict: [
    {
      grant: '*',
      to: 'admin',
      where: 'title = ''ABC'''
    }
  ])
  entity Incidents as projection on my.Incidents;

  @(restrict: [
    {
      grant: '*',
      to: 'admin',
      where: 'title = ''ABC'''
    }
  ]) 
  @odata.draft.enabled
  @cds.redirection.target
  entity DraftIcidents as projection on my.Incidents;
}

annotate ProcessorService.Incidents with @odata.draft.enabled; 
annotate ProcessorService with @(requires: 'support');
annotate AdminService with @(requires: 'admin');
