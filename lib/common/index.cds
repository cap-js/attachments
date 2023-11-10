using {sap.attachments as db} from '../../index.cds';

@path    : 'media'
@protocol: 'none'
service AttachmentsService {

    entity Images    as projection on db.Images;
    entity Documents as projection on db.Documents;

    action onGET(entity: String, items: Records[]) returns {
        objects: String[];
    };

    action onPUT(entity: String, items: Records[]) returns {};

    action onSTREAM(entity: String, fileName: String) returns {
        stream: LargeBinary;
    };

}
