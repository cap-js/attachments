@protocol: 'none'
service AWSAttachmentsService {

    action onSTREAM(fileName : String) returns {
        inputStream : Binary
    };

}
