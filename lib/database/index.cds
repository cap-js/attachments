using { cuid, managed } from '@sap/cds/common';

@protocol: 'none'
service DBAttachmentsService {

    action onSTREAM(fileName : String) returns {
        inputStream : LargeBinary;
    };

}
