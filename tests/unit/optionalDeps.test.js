describe("optional peer dependency errors", () => {
  const makeNotFound = (pkg) => {
    const err = new Error(`Cannot find module '${pkg}'`)
    err.code = "MODULE_NOT_FOUND"
    return err
  }

  test("aws-s3 throws helpful error when @aws-sdk/client-s3 is missing", () => {
    jest.isolateModules(() => {
      jest.doMock("@aws-sdk/client-s3", () => {
        throw makeNotFound("@aws-sdk/client-s3")
      })
      expect(() => require("../../srv/attachments/aws-s3")).toThrow(
        "npm install @aws-sdk/client-s3 @aws-sdk/lib-storage",
      )
    })
  })

  test("aws-s3 throws helpful error when @aws-sdk/lib-storage is missing", () => {
    jest.isolateModules(() => {
      jest.doMock("@aws-sdk/lib-storage", () => {
        throw makeNotFound("@aws-sdk/lib-storage")
      })
      expect(() => require("../../srv/attachments/aws-s3")).toThrow(
        "npm install @aws-sdk/client-s3 @aws-sdk/lib-storage",
      )
    })
  })

  test("azure-blob-storage throws helpful error when @azure/storage-blob is missing", () => {
    jest.isolateModules(() => {
      jest.doMock("@azure/storage-blob", () => {
        throw makeNotFound("@azure/storage-blob")
      })
      expect(() => require("../../srv/attachments/azure-blob-storage")).toThrow(
        "npm install @azure/storage-blob",
      )
    })
  })

  test("gcp throws helpful error when @google-cloud/storage is missing", () => {
    jest.isolateModules(() => {
      jest.doMock("@google-cloud/storage", () => {
        throw makeNotFound("@google-cloud/storage")
      })
      expect(() => require("../../srv/attachments/gcp")).toThrow(
        "npm install @google-cloud/storage",
      )
    })
  })

  test("aws-s3 loads successfully when SDKs are present", () => {
    jest.isolateModules(() => {
      jest.dontMock("@aws-sdk/client-s3")
      jest.dontMock("@aws-sdk/lib-storage")
      expect(() => require("../../srv/attachments/aws-s3")).not.toThrow()
    })
  })

  test("azure-blob-storage loads successfully when SDK is present", () => {
    jest.isolateModules(() => {
      jest.dontMock("@azure/storage-blob")
      expect(() =>
        require("../../srv/attachments/azure-blob-storage"),
      ).not.toThrow()
    })
  })

  test("gcp loads successfully when SDK is present", () => {
    jest.isolateModules(() => {
      jest.dontMock("@google-cloud/storage")
      expect(() => require("../../srv/attachments/gcp")).not.toThrow()
    })
  })
})
