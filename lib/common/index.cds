@protocol: 'none'
service AttachmentsService {

    action onGET(origin : String)      returns {
        objectList : String;
    };

    action onSTREAM(fileName : String) returns {
        inputStream : LargeBinary;
    };

}
