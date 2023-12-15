using { sap.attachments as my } from '../../index.cds';

@protocol: 'none'
service AttachmentsService {

    action onGET(entity: String, items: String) returns {
        objects: String;
    };

    action onPUT(entity: String, items: String) returns {};

    action onSTREAM(entity: String, fileName: String) returns {
        stream: LargeBinary;
    };

}
