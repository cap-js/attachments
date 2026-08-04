"use strict"
require("../../lib/csn-runtime-extension")
const cds = require("@sap/cds")
const path = require("path")

const app = path.join(__dirname, "../incidents-app")
cds.test(app)

let attachmentsSvc
let originalConnectTo
let originalSpawn
let originalTx

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

  originalSpawn = cds.spawn
  cds.spawn = jest.fn().mockImplementation((fn) => {
    return { on: jest.fn() }
  })

  originalTx = cds.tx
  cds.tx = jest.fn().mockImplementation(async (fn) => await fn())
})

afterEach(() => {
  cds.connect.to = originalConnectTo
  cds.spawn = originalSpawn
  cds.tx = originalTx
  cds.env.requires.attachments = undefined
})

describe("scan-status gate for /content and /content/$value", () => {
  /**
   * Helper that calls validateAttachment with a given URL and an Infected status.
   * Returns the result of the call (or throws if the handler throws/rejects).
   */
  async function callValidateWithUrl(url) {
    const target = cds.model.definitions["AdminService.Incidents.attachments"]
    const attachmentId = cds.utils.uuid()

    attachmentsSvc.getStatus = jest.fn().mockResolvedValue({
      status: "Infected",
      lastScan: new Date().toISOString(),
    })

    const req = {
      target,
      data: { ID: attachmentId },
      req: { url },
      query: { SELECT: { columns: [] } },
      params: [{ ID: attachmentId }],
      reject: jest.fn(),
    }

    cds.env.requires.attachments = { scan: true }

    await require("../../lib/generic-handlers").validateAttachment(req)
    return req
  }

  it("GET /content on Infected attachment calls req.reject(403)", async () => {
    const req = await callValidateWithUrl(
      "/odata/v4/processor/Incidents/content",
    )
    expect(req.reject).toHaveBeenCalledWith(
      403,
      "UnableToDownloadAttachmentScanStatusNotClean",
    )
  })

  it("[BUG] GET /content/$value on Infected attachment must also call req.reject(403)", async () => {
    // Currently fails because endsWith('/content') and /\/[^/]*_content$/ both
    // miss the /$value suffix — the gate is never entered.
    const req = await callValidateWithUrl(
      "/odata/v4/processor/Incidents/content/$value",
    )
    expect(req.reject).toHaveBeenCalledWith(
      403,
      "UnableToDownloadAttachmentScanStatusNotClean",
    )
  })

  it("GET /foo_content/$value on Infected inline attachment must also call req.reject(403)", async () => {
    // Inline attachment variant — also broken before the fix
    const req = await callValidateWithUrl(
      "/odata/v4/processor/Entity(ID=1)/foo_content/$value",
    )
    // For inline attachments, getScanInfo takes a different code path (not isAttachmentsEntity)
    // so if the gate IS entered, getStatus won't be called, but reject still should be called
    // if the scan path works. This test primarily verifies the gate is entered.
    // (For simplicity we only check that the req was processed past the gate check)
    // The gate check is: isContentRequest(reqUrl) must return true for this URL.
    // After fix: isContentRequest returns true, getScanInfo is called.
    // Since target is AdminService.Incidents.attachments (isAttachmentsEntity=true),
    // getStatus will be called and rejection will happen.
    expect(req.reject).toHaveBeenCalledWith(
      403,
      "UnableToDownloadAttachmentScanStatusNotClean",
    )
  })
})
