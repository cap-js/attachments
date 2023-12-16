@protocol: 'none'
service AttachmentsService {
  action onGET(entity: String, items: String) returns { objects: String; };
  action onPUT(entity: String, items: String) returns {};
  action onSTREAM(entity: String, filename: String) returns { stream: LargeBinary; };
}
