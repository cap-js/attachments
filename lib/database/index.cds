@protocol: 'none'
service DBAttachmentsService {

    action onGET(origin : String)      returns {
        objectList : String;
    };

    action onSTREAM(fileName : String) returns {
        inputStream : LargeBinary;
    };

}
