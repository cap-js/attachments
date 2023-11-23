using {sap.attachments as my} from '../../index.cds';

@protocol: 'none'
service DBAttachmentsService {

    entity Images    as projection on my.Images;
    entity Documents as projection on my.Documents;

}
