require("../../lib/csn-runtime-extension")
const cds = require("@sap/cds")
const { join } = cds.utils.path
const app = join(__dirname, "../incidents-app")
cds.test(app)

const {
  validateAttachmentMimeType,
  validateAttachmentSize,
} = require("../../lib/generic-handlers")

let attachmentsSvc
let originalConnectTo

beforeEach(() => {
  jest.restoreAllMocks()

  attachmentsSvc = {
    emit: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn(),
  }
  originalConnectTo = cds.connect.to
  cds.connect.to = jest.fn().mockImplementation((name) => {
    if (name === "attachments") return Promise.resolve(attachmentsSvc)
    return originalConnectTo.call(cds.connect, name)
  })
})

afterEach(() => {
  cds.connect.to = originalConnectTo
})

describe("AttachmentUploadRejected event", () => {
  it("should emit when MIME type is rejected", async () => {
    const req = {
      target: {
        name: "TestService.Attachments",
        _attachments: { isAttachmentsEntity: true },
        elements: {
          content: {
            "@Core.AcceptableMediaTypes": ["image/jpeg", "image/png"],
          },
        },
      },
      data: {
        content: "test content",
        mimeType: "text/plain",
        ID: "att-123",
        filename: "notes.txt",
      },
      reject: jest.fn(),
    }

    await validateAttachmentMimeType(req)

    expect(req.reject).toHaveBeenCalledWith(
      400,
      "AttachmentMimeTypeDisallowed",
      {
        mimeType: "text/plain",
      },
    )

    // Wait for the fire-and-forget promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(attachmentsSvc.emit).toHaveBeenCalledWith(
      "AttachmentUploadRejected",
      expect.objectContaining({
        target: "TestService.Attachments",
        keys: { ID: "att-123" },
        filename: "notes.txt",
        mimeType: "text/plain",
        acceptableMediaTypes: ["image/jpeg", "image/png"],
        reason: expect.stringContaining("@Core.AcceptableMediaTypes"),
      }),
    )
  })

  it("should not emit when MIME type is allowed", async () => {
    const req = {
      target: {
        name: "TestService.Attachments",
        _attachments: { isAttachmentsEntity: true },
        elements: {
          content: {
            "@Core.AcceptableMediaTypes": ["image/jpeg"],
          },
        },
      },
      data: {
        content: "test content",
        mimeType: "image/jpeg",
        ID: "att-123",
        filename: "photo.jpg",
      },
      reject: jest.fn(),
    }

    const result = await validateAttachmentMimeType(req)

    expect(result).toBe(true)
    expect(req.reject).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(attachmentsSvc.emit).not.toHaveBeenCalled()
  })

  it("should still reject when event handler fails", async () => {
    attachmentsSvc.emit.mockRejectedValue(new Error("handler error"))

    const req = {
      target: {
        name: "TestService.Attachments",
        _attachments: { isAttachmentsEntity: true },
        elements: {
          content: {
            "@Core.AcceptableMediaTypes": ["image/jpeg"],
          },
        },
      },
      data: {
        content: "test content",
        mimeType: "text/plain",
        ID: "att-123",
        filename: "notes.txt",
      },
      reject: jest.fn(),
    }

    const result = await validateAttachmentMimeType(req)

    expect(result).toBe(false)
    expect(req.reject).toHaveBeenCalledWith(
      400,
      "AttachmentMimeTypeDisallowed",
      {
        mimeType: "text/plain",
      },
    )
  })
})

describe("AttachmentSizeExceeded event", () => {
  it("should emit when file size exceeds the limit", async () => {
    // Use maximumSizeAttachments which has @Validation.Maximum: '5MB'
    const target =
      cds.model.definitions["AdminService.Incidents.maximumSizeAttachments"]

    const keys = { up__ID: cds.utils.uuid(), ID: cds.utils.uuid() }
    await INSERT.into(target).entries({
      ...keys,
      filename: "large-file.pdf",
      status: "Scanning",
    })

    const req = {
      target,
      data: {
        content: { pause: jest.fn() },
        up__ID: keys.up__ID,
        ID: keys.ID,
      },
      headers: { "content-length": "999999999999" },
      reject: jest.fn(),
    }

    await validateAttachmentSize(req)

    expect(req.reject).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 413,
        message: "AttachmentSizeExceeded",
      }),
    )

    // Wait for fire-and-forget promise
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(attachmentsSvc.emit).toHaveBeenCalledWith(
      "AttachmentSizeExceeded",
      expect.objectContaining({
        target: target.name,
        filename: "large-file.pdf",
        maxFileSize: expect.any(Number),
        fileSize: expect.any(Number),
      }),
    )
  })

  it("should not emit when file size is within limit", async () => {
    const target =
      cds.model.definitions["AdminService.Incidents.maximumSizeAttachments"]

    const req = {
      target,
      data: {
        content: Buffer.from("small"),
        up__ID: cds.utils.uuid(),
        ID: cds.utils.uuid(),
      },
      headers: { "content-length": "5" },
      reject: jest.fn(),
    }

    const result = await validateAttachmentSize(req)

    expect(result).toBe(true)
    expect(req.reject).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(attachmentsSvc.emit).not.toHaveBeenCalled()
  })

  it("should still reject when event handler fails", async () => {
    attachmentsSvc.emit.mockRejectedValue(new Error("handler error"))

    // Use maximumSizeAttachments which has @Validation.Maximum: '5MB'
    const target =
      cds.model.definitions["AdminService.Incidents.maximumSizeAttachments"]

    const keys = { up__ID: cds.utils.uuid(), ID: cds.utils.uuid() }
    await INSERT.into(target).entries({
      ...keys,
      filename: "large-file.pdf",
      status: "Scanning",
    })

    const req = {
      target,
      data: {
        content: { pause: jest.fn() },
        up__ID: keys.up__ID,
        ID: keys.ID,
      },
      headers: { "content-length": "999999999999" },
      reject: jest.fn(),
    }

    await validateAttachmentSize(req)

    expect(req.reject).toHaveBeenCalledWith(
      expect.objectContaining({ status: 413 }),
    )
  })
})

describe("AttachmentDownloadRejected event", () => {
  it("should emit when download is rejected due to non-clean scan status", async () => {
    const target = cds.model.definitions["AdminService.Incidents.attachments"]

    attachmentsSvc.getStatus = jest.fn().mockResolvedValue({
      status: "Infected",
      lastScan: new Date().toISOString(),
    })

    const attachmentId = cds.utils.uuid()
    const req = {
      target,
      data: { ID: attachmentId },
      req: { url: "/some/path/content" },
      query: { SELECT: { columns: [] } },
      params: [{ ID: attachmentId }],
      reject: jest.fn(),
    }

    cds.env.requires.attachments = { scan: true }

    await require("../../lib/generic-handlers").validateAttachment(req)

    expect(req.reject).toHaveBeenCalledWith(
      403,
      "UnableToDownloadAttachmentScanStatusNotClean",
    )

    expect(attachmentsSvc.emit).toHaveBeenCalledWith(
      "AttachmentDownloadRejected",
      expect.objectContaining({
        target: target.name,
        keys: { ID: attachmentId },
        status: "Infected",
      }),
    )
  })

  it("should not emit when scan status is Clean", async () => {
    const target = cds.model.definitions["AdminService.Incidents.attachments"]

    attachmentsSvc.getStatus = jest.fn().mockResolvedValue({
      status: "Clean",
      lastScan: new Date().toISOString(),
    })

    const attachmentId = cds.utils.uuid()
    const req = {
      target,
      data: { ID: attachmentId },
      req: { url: "/some/path/content" },
      query: { SELECT: { columns: [] } },
      params: [{ ID: attachmentId }],
      reject: jest.fn(),
    }

    cds.env.requires.attachments = { scan: true }

    await require("../../lib/generic-handlers").validateAttachment(req)

    expect(req.reject).not.toHaveBeenCalled()
    expect(attachmentsSvc.emit).not.toHaveBeenCalledWith(
      "AttachmentDownloadRejected",
      expect.anything(),
    )
  })
})
