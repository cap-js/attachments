require("../../lib/csn-runtime-extension")
const cds = require("@sap/cds")
const path = require("path")
const app = path.resolve(__dirname, "../incidents-app")
cds.test(app)

const { rescanStuckAttachments } = require("../../lib/plugin")

let msEmit

beforeEach(() => {
  jest.clearAllMocks()
  cds.env.requires.attachments = { scan: true, rescanOnStart: true }
  msEmit = jest.fn().mockResolvedValue(undefined)
  cds.connect.to = jest.fn().mockResolvedValue({ emit: msEmit })
})

// ---------------------------------------------------------------------------
// Guard conditions
// ---------------------------------------------------------------------------

describe("guard conditions", () => {
  it("does not connect to malwareScanner when scan is disabled", async () => {
    cds.env.requires.attachments.scan = false
    await rescanStuckAttachments()
    expect(cds.connect.to).not.toHaveBeenCalled()
  })

  it("does not connect when rescanOnStart is false (default)", async () => {
    cds.env.requires.attachments.rescanOnStart = false
    await rescanStuckAttachments()
    expect(cds.connect.to).not.toHaveBeenCalled()
  })

  it("does not connect when rescanOnStart is absent (defaults to false)", async () => {
    delete cds.env.requires.attachments.rescanOnStart
    await rescanStuckAttachments()
    expect(cds.connect.to).not.toHaveBeenCalled()
  })

  it("does not connect when attachments config is absent", async () => {
    delete cds.env.requires.attachments
    await rescanStuckAttachments()
    expect(cds.connect.to).not.toHaveBeenCalled()
    // Restore for subsequent tests
    cds.env.requires.attachments = { scan: true, rescanOnStart: true }
  })
})

// ---------------------------------------------------------------------------
// Composition-based attachment entity (ProcessorService.Incidents.attachments)
//   keys: up__ID (parent key) + ID (attachment key)
//   status column: "status"
// ---------------------------------------------------------------------------

describe("composition attachment entity", () => {
  const attachmentsEntity = "sap.capire.incidents.Incidents.attachments"
  const upID = cds.utils.uuid()
  const attachmentID = cds.utils.uuid()

  beforeEach(async () => {
    // Seed a row stuck in "Scanning" directly in the DB
    await INSERT.into(cds.model.definitions[attachmentsEntity]).entries({
      up__ID: upID,
      ID: attachmentID,
      filename: "stuck.pdf",
      mimeType: "application/pdf",
      status: "Scanning",
    })
  })

  afterEach(async () => {
    await DELETE.from(cds.model.definitions[attachmentsEntity]).where({
      ID: attachmentID,
    })
  })

  it("re-emits ScanAttachmentsFile for a row stuck in Scanning", async () => {
    await rescanStuckAttachments()

    expect(msEmit).toHaveBeenCalledWith("ScanAttachmentsFile", {
      target: attachmentsEntity,
      keys: { up__ID: upID, ID: attachmentID },
    })
  })

  it("does not re-emit for a row with status Clean", async () => {
    await UPDATE(cds.model.definitions[attachmentsEntity])
      .where({ ID: attachmentID })
      .set({ status: "Clean" })

    await rescanStuckAttachments()

    const callsForRow = (msEmit.mock.calls || []).filter(
      ([, payload]) => payload?.keys?.ID === attachmentID,
    )
    expect(callsForRow).toHaveLength(0)
  })

  it("does not re-emit for a row with status Unscanned", async () => {
    await UPDATE(cds.model.definitions[attachmentsEntity])
      .where({ ID: attachmentID })
      .set({ status: "Unscanned" })

    await rescanStuckAttachments()

    const callsForRow = (msEmit.mock.calls || []).filter(
      ([, payload]) => payload?.keys?.ID === attachmentID,
    )
    expect(callsForRow).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Inline attachment entity (ProcessorService.SingleAttachment, prefix "myAttachment")
//   key: ID
//   status column: "myAttachment_status", url column: "myAttachment_url"
// ---------------------------------------------------------------------------

describe("inline attachment entity", () => {
  // Use the base entity for DB operations; the sweep may emit via any projection of it.
  const inlineEntityBase = "sap.capire.incidents.SingleAttachment"
  const rowID = cds.utils.uuid()
  const objectUrl = "https://objectstore.example.com/myfile.pdf"

  beforeEach(async () => {
    await INSERT.into(cds.model.definitions[inlineEntityBase]).entries({
      ID: rowID,
      name: "Test inline",
      myAttachment_status: "Scanning",
      myAttachment_url: objectUrl,
      myAttachment_mimeType: "application/pdf",
      myAttachment_filename: "stuck-inline.pdf",
    })
  })

  afterEach(async () => {
    await DELETE.from(cds.model.definitions[inlineEntityBase]).where({
      ID: rowID,
    })
  })

  it("re-emits ScanAttachmentsFile with prefix and url for a stuck inline row", async () => {
    await rescanStuckAttachments()

    const call = (msEmit.mock.calls || []).find(
      ([, payload]) => payload?.keys?.ID === rowID,
    )
    expect(call).toBeDefined()
    expect(call[0]).toBe("ScanAttachmentsFile")
    // target may be any projection of the base entity — just verify the payload shape
    expect(call[1].target).toMatch(/SingleAttachment$/)
    expect(call[1].keys).toEqual({ ID: rowID })
    expect(call[1].prefix).toBe("myAttachment")
    expect(call[1].url).toBe(objectUrl)
  })

  it("does not re-emit for a Clean inline row", async () => {
    await UPDATE(cds.model.definitions[inlineEntityBase])
      .where({ ID: rowID })
      .set({ myAttachment_status: "Clean" })

    await rescanStuckAttachments()

    const callsForRow = (msEmit.mock.calls || []).filter(
      ([, payload]) => payload?.keys?.ID === rowID,
    )
    expect(callsForRow).toHaveLength(0)
  })
})
