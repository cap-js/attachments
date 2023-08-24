service ObjectStoreService {

    action uploadFile (
        bytes: Integer,
        name: String,
        contentType: String
    ) returns {message: String};

    action deleteFile (
        fileName: String
    ) returns {status: Boolean};

    action getFile (
        fileName: String
    ) returns {inputStream: Binary};

    action listObjects (
    ) returns {files: LargeBinary};

    action isBlobExist(
        name: String
    ) returns {status: Boolean};

}
