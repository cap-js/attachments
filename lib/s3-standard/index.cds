@protocol: 'none'
service AWSAttachmentsService {

    action onGET(req: String, images: String)      returns {
        objectList : String;
    };

    action onPUT(entity : String, files: array of String) returns {};

    action onSTREAM(fileName : String) returns {
        inputStream : LargeBinary
    };

}
