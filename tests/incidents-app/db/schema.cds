using {
  cuid,
  managed,
  sap.common.CodeList
} from '@sap/cds/common';
using {Attachments} from '@cap-js/attachments';

namespace sap.capire.incidents;

/**
 * Customers using products sold by our company.
 * Customers can create support Incidents.
 */
entity Customers : managed {
  key ID           : String;
      firstName    : String;
      lastName     : String;
      name         : String = firstName || ' ' || lastName;
      email        : EMailAddress;
      phone        : PhoneNumber;
      creditCardNo : String(16) @assert.format: '^[1-9]\d{15}$';
      addresses    : Composition of many Addresses
                       on addresses.customer = $self;
      incidents    : Association to many Incidents
                       on incidents.customer = $self;
}

entity Addresses : cuid, managed {
  customer      : Association to Customers;
  city          : String;
  postCode      : String;
  streetAddress : String;
}


/**
 * Incidents created by Customers.
 */
entity Incidents : cuid, managed {
  customer     : Association to Customers;
  title        : String @title: 'Title';
  urgency      : Association to Urgency default 'M';
  status       : Association to Status default 'N';
  conversation : Composition of many {
                   key ID          : UUID;
                       timestamp   : type of managed : createdAt;
                       author      : type of managed : createdBy;
                       message     : String;
                       attachments : Composition of many Attachments;
                 };
}

entity Status : CodeList {
  key code        : String enum {
        new = 'N';
        assigned = 'A';
        in_process = 'I';
        on_hold = 'H';
        resolved = 'R';
        closed = 'C';
      };
      criticality : Integer;
}

entity Urgency : CodeList {
  key code : String enum {
        high = 'H';
        medium = 'M';
        low = 'L';
      };
}

type EMailAddress : String;
type PhoneNumber  : String;


entity SampleRootWithComposedEntity {
  key sampleID : String;
  key gjahr    : Integer;
}

entity Test : cuid, managed {
  key ID      : String;
      name    : String;
      details : Composition of many TestDetails
                  on details.test = $self;
}

entity TestDetails : cuid, managed {
  test        : Association to Test;
  description : String;
}

entity NonDraftTest : cuid, managed {
  key ID            : UUID;
      name          : String;
      singledetails : Composition of one SingleTestDetails;
}

entity SingleTestDetails : cuid {
  abc : String;
}

entity Posts : cuid, managed {
    content : String;
    comments  : Composition of many Comments on comments.post = $self;
}

entity Comments : cuid, managed {
    content : String;
    post : Association to Posts;
    replyTo : Association to Comments;
    replies : Composition of many Comments on replies.replyTo = $self;
}

//TODO: Clean up test schemas
/**
 * Deep nesting test entities for depth 3 and 4.
 * Each intermediate entity uses a named back-association (not up_)
 * and has extra compositions to verify back-association discovery
 * doesn't get confused by sibling compositions.
 */
entity Level0 : cuid, managed {
    name     : String;
    notes    : Composition of many Level0Notes on notes.root = $self;
    children : Composition of many Level1 on children.parent = $self;
}

entity Level0Notes : cuid {
    root : Association to Level0;
    text : String;
}

entity Level1 : cuid, managed {
    parent   : Association to Level0;
    name     : String;
    tags     : Composition of many Level1Tags on tags.owner = $self;
    children : Composition of many Level2 on children.holder = $self;
}

entity Level1Tags : cuid {
    owner : Association to Level1;
    label : String;
}

entity Level2 : cuid, managed {
    holder   : Association to Level1;
    name     : String;
    items    : Composition of many Level3 on items.container = $self;
}

entity Level3 : cuid, managed {
    container : Association to Level2;
    name      : String;
}