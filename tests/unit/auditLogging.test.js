require("../../lib/csn-runtime-extension")
const cds = require("@sap/cds")
cds.env.requires["audit-log"] = {
  impl: "@cap-js/audit-logging/srv/log2console",
  outbox: false,
}
const { join } = cds.utils.path
const app = join(__dirname, "../incidents-app")
cds.test(app)

let attachmentsSvc

beforeEach(async () => {
  const svc = await cds.connect.to("attachments")
  attachmentsSvc = cds.unboxed(svc)
})

describe("Audit logging for security events (audit-logging dependency present)", () => {
  const log = cds.test.log()

  it("should log AttachmentDownloadRejected as SecurityEvent", async () => {
    await attachmentsSvc.emit("AttachmentDownloadRejected", {
      target: "AdminService.Incidents.attachments",
      keys: { ID: "att-001" },
      status: "Infected",
      ipAddress: "10.0.0.1",
    })

    expect(log.output).toContain("[audit-log] - SecurityEvent:")
    expect(log.output).toContain("AttachmentDownloadRejected")
    expect(log.output).toContain("Infected")
  })

  it("should log AttachmentSizeExceeded as SecurityEvent", async () => {
    await attachmentsSvc.emit("AttachmentSizeExceeded", {
      target: "AdminService.Incidents.attachments",
      keys: { ID: "att-002" },
      filename: "large-file.pdf",
      fileSize: 999999999,
      maxFileSize: 5242880,
      ipAddress: "192.168.1.10",
    })

    expect(log.output).toContain("[audit-log] - SecurityEvent:")
    expect(log.output).toContain("AttachmentSizeExceeded")
    expect(log.output).toContain("large-file.pdf")
    expect(log.output).toContain("999999999")
    expect(log.output).toContain("5242880")
  })

  it("should log AttachmentUploadRejected as SecurityEvent", async () => {
    await attachmentsSvc.emit("AttachmentUploadRejected", {
      target: "AdminService.Incidents.attachments",
      keys: { ID: "att-003" },
      filename: "script.exe",
      mimeType: "application/x-msdownload",
      acceptableMediaTypes: ["image/jpeg", "image/png"],
      reason:
        "MIME type 'application/x-msdownload' is not in @Core.AcceptableMediaTypes",
      ipAddress: "172.16.0.5",
    })

    expect(log.output).toContain("[audit-log] - SecurityEvent:")
    expect(log.output).toContain("AttachmentUploadRejected")
    expect(log.output).toContain("script.exe")
    expect(log.output).toContain("application/x-msdownload")
  })
})

describe("Audit logging when audit-logging is disabled", () => {
  const log = cds.test.log()

  it("should not register audit log handlers when hasAuditLogging returns false", async () => {
    // Override hasAuditLogging to return false
    const originalLog = cds.env.requires["audit-log"]
    cds.env.requires["audit-log"] = false

    // Create a fresh AttachmentsService instance with audit logging disabled
    const AttachmentsService = require("../../srv/attachments/basic")
    const svc = new AttachmentsService()
    svc.model = cds.model
    // Stub super.init() to avoid full service bootstrap
    const origInit = Object.getPrototypeOf(AttachmentsService.prototype).init
    Object.getPrototypeOf(AttachmentsService.prototype).init = jest
      .fn()
      .mockResolvedValue(undefined)

    await svc.init()

    // Restore super.init
    Object.getPrototypeOf(AttachmentsService.prototype).init = origInit

    // The service should have handlers for DeleteAttachment and DeleteInfectedAttachment
    // but NOT for the security events routed to audit logging
    const registeredEvents = (svc._handlers?.on || []).map((h) =>
      Array.isArray(h.for) ? h.for : [h.for],
    )
    const flatEvents = registeredEvents.flat().filter(Boolean)

    expect(flatEvents).not.toContain("AttachmentDownloadRejected")
    expect(flatEvents).not.toContain("AttachmentSizeExceeded")
    expect(flatEvents).not.toContain("AttachmentUploadRejected")

    // Verify no audit log output was produced
    expect(log.output).not.toContain("[audit-log] - SecurityEvent:")
    cds.env.requires["audit-log"] = originalLog
  })
})
