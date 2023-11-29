using { sap.attachments as my } from '../../index.cds';

@protocol: 'none'
service AttachmentsService {

    entity Images    as projection on my.Images;
    entity Documents as projection on my.Attachments;

    action onGET(entity: String, items: String) returns {
        objects: String;
    };

    action onPUT(entity: String, items: String) returns {};

    action onSTREAM(entity: String, fileName: String) returns {
        stream: LargeBinary;
    };

}
