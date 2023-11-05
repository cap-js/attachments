@protocol: 'none'
service DBAttachmentsService {

    action onGET(entity: String, resources: String)      returns {
        objectList : String;
    };

    action onPUT(entity : String, files: array of String) returns {};

    action onSTREAM(fileName : String) returns {
        inputStream : LargeBinary;
    };

}
