@protocol: 'none'
service DBAttachmentsService {

    action onGET(origin : String)      returns {
        objectList : String;
    };

    action onPUT(entity : String, files: array of String) returns {};

    action onSTREAM(fileName : String) returns {
        inputStream : LargeBinary;
    };

}
