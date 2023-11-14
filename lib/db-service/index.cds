using {sap.attachments as db} from '../../index.cds';

@path    : 'media'
@protocol: 'none'
service DBAttachmentsService {

    entity Images    as projection on db.Images;
    entity Documents as projection on db.Documents;

}
