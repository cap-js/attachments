@protocol: 'none'
service AttachmentsService {

    action onSTREAM(fileName : String) returns {
        inputStream : LargeBinary;
    };

    action onGET() returns {
        objectList: String;
    }

}
