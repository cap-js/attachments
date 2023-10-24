@protocol: 'none'
service AttachmentsService {

    action onSTREAM(fileName : String)                             returns {
        inputStream : Binary
    };

    // action createStore()                                                    returns {
    //     message : String
    // };

    // action uploadBulk(attachments : String, images : String) returns {
    //     message : String
    // };

    // action emptyBucket(attachments : String, images : String) returns {
    //     message : String
    // };

    // action uploadFile(bytes : Integer, name : String, contentType : String) returns {
    //     message : String
    // };

    // action deleteFile(fileName : String)                                    returns {
    //     status : Boolean
    // };

    // action getFile(fileName : String)                                       returns {
    //     inputStream : Binary
    // };

    // action listObjects()                                                    returns {
    //     files : LargeBinary
    // };

    // action isBlobExist(name : String)                                       returns {
    //     status : Boolean
    // };

}
