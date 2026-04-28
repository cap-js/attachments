require("../../lib/csn-runtime-extension")
const cds = require("@sap/cds")
const { join } = cds.utils.path
cds.test(join(__dirname, "../incidents-app"))

const MalwareScanner = require("../../srv/malware-scanner/malwareScanner")

let scanner
let processorSrv
let spawnCallback

beforeEach(() => {
  jest.clearAllMocks()

  cds.env.requires.attachments = { scan: true }
  cds.env.requires.malwareScanner = {
    credentials: { uri: "host", certificate: "C", key: "K" },
  }

  jest.spyOn(cds, "context", "get").mockReturnValue({ model: cds.model })

  processorSrv = { emit: jest.fn().mockResolvedValue(undefined) }

  cds.connect.to = jest.fn().mockImplementation(async (name) => {
    if (name === "ProcessorService") return processorSrv
    return { emit: jest.fn(), get: jest.fn() }
  })

  // Capture the cds.spawn callback so we can execute it synchronously in tests
  spawnCallback = null
  jest.spyOn(cds, "spawn").mockImplementation((_opts, fn) => {
    spawnCallback = fn
    return { on: jest.fn() }
  })

  scanner = new MalwareScanner()
  scanner.retryConfig = {
    enabled: false,
    maxAttempts: 1,
    initialDelay: 1000,
    maxDelay: 30000,
  }
  scanner.scan = jest.fn()
})

// ---------------------------------------------------------------------------
// updateStatus — WebSocket event emission (attachmentStatusChanged)
// ---------------------------------------------------------------------------

describe("updateStatus - attachmentStatusChanged event emission", () => {
  const _target = () =>
    cds.model.definitions["ProcessorService.Incidents.attachments"]

  it("emits attachmentStatusChanged with draft path when draft exists", async () => {
    const target = _target()
    const keys = { up__ID: cds.utils.uuid(), ID: cds.utils.uuid() }

    await INSERT.into(target).entries({
      ...keys,
      status: "Scanning",
      filename: "test.pdf",
    })
    await INSERT.into(target.drafts).entries({
      ...keys,
      status: "Scanning",
      filename: "test.pdf",
      DraftAdministrativeData_DraftUUID: cds.utils.uuid(),
    })

    await scanner.updateStatus(target, keys, "Clean")

    expect(cds.spawn).toHaveBeenCalled()
    await spawnCallback()

    expect(processorSrv.emit).toHaveBeenCalledWith(
      "attachmentStatusChanged",
      expect.objectContaining({
        sideEffectSource: expect.stringContaining("IsActiveEntity=false"),
      }),
    )

    const emitCall = processorSrv.emit.mock.calls[0]
    const source = emitCall[1].sideEffectSource
    expect(source).toMatch(
      new RegExp(
        `^/Incidents\\(ID=${keys.up__ID},IsActiveEntity=false\\)/attachments\\(ID=${keys.ID},IsActiveEntity=false\\)$`,
      ),
    )
  })

  it("emits attachmentStatusChanged with active path when only active exists", async () => {
    const target = _target()
    const keys = { up__ID: cds.utils.uuid(), ID: cds.utils.uuid() }

    // Only insert into active, no draft
    await INSERT.into(target).entries({
      ...keys,
      status: "Scanning",
      filename: "test.pdf",
    })

    await scanner.updateStatus(target, keys, "Clean")

    expect(cds.spawn).toHaveBeenCalled()
    await spawnCallback()

    expect(processorSrv.emit).toHaveBeenCalledWith(
      "attachmentStatusChanged",
      expect.objectContaining({
        sideEffectSource: expect.stringContaining("IsActiveEntity=true"),
      }),
    )

    const emitCall = processorSrv.emit.mock.calls[0]
    const source = emitCall[1].sideEffectSource
    expect(source).toMatch(
      new RegExp(
        `^/Incidents\\(ID=${keys.up__ID},IsActiveEntity=true\\)/attachments\\(ID=${keys.ID},IsActiveEntity=true\\)$`,
      ),
    )
  })

  it("does not emit when neither active nor draft exists", async () => {
    const target = _target()
    const keys = { up__ID: cds.utils.uuid(), ID: cds.utils.uuid() }

    // Insert then delete to ensure rows don't exist
    await INSERT.into(target).entries({
      ...keys,
      status: "Scanning",
      filename: "test.pdf",
    })
    await DELETE.from(target).where(keys)

    await scanner.updateStatus(target, keys, "Clean")

    expect(cds.spawn).toHaveBeenCalled()
    await spawnCallback()

    expect(processorSrv.emit).not.toHaveBeenCalled()
  })

  it("does not emit or spawn for non-draft entities", async () => {
    const target = cds.model.definitions["AdminService.Incidents.attachments"]
    expect(target.drafts).toBeFalsy()

    const keys = { up__ID: cds.utils.uuid(), ID: cds.utils.uuid() }
    await INSERT.into(target).entries({
      ...keys,
      status: "Scanning",
      filename: "test.pdf",
    })

    await scanner.updateStatus(target, keys, "Clean")

    expect(cds.spawn).not.toHaveBeenCalled()
    expect(processorSrv.emit).not.toHaveBeenCalled()
  })

  it("constructs correct sideEffectSource path with parent entity and composition name", async () => {
    const target = _target()
    const keys = { up__ID: cds.utils.uuid(), ID: cds.utils.uuid() }

    await INSERT.into(target.drafts).entries({
      ...keys,
      status: "Scanning",
      filename: "test.pdf",
      DraftAdministrativeData_DraftUUID: cds.utils.uuid(),
    })

    await scanner.updateStatus(target, keys, "Scanning")

    expect(cds.spawn).toHaveBeenCalled()
    await spawnCallback()

    const emitCall = processorSrv.emit.mock.calls[0]
    const source = emitCall[1].sideEffectSource

    // Should start with /Incidents (parent entity short name)
    expect(source).toMatch(/^\/Incidents\(/)
    // Should contain /attachments( (composition name)
    expect(source).toContain("/attachments(")
    // Should contain parent key
    expect(source).toContain(`ID=${keys.up__ID}`)
    // Should contain attachment ID
    expect(source).toContain(`ID=${keys.ID}`)
  })

  it("connects to correct service derived from parent entity", async () => {
    const target = _target()
    const keys = { up__ID: cds.utils.uuid(), ID: cds.utils.uuid() }

    await INSERT.into(target.drafts).entries({
      ...keys,
      status: "Scanning",
      filename: "test.pdf",
      DraftAdministrativeData_DraftUUID: cds.utils.uuid(),
    })

    await scanner.updateStatus(target, keys, "Clean")

    expect(cds.spawn).toHaveBeenCalled()
    await spawnCallback()

    expect(cds.connect.to).toHaveBeenCalledWith("ProcessorService")
  })
})

// ---------------------------------------------------------------------------
// unfoldModel — auto-generated event and SideEffects annotation
// ---------------------------------------------------------------------------

describe("unfoldModel - attachmentStatusChanged event and SideEffects", () => {
  it("adds attachmentStatusChanged event to services with attachment compositions", () => {
    const eventDef =
      cds.model.definitions["ProcessorService.attachmentStatusChanged"]
    expect(eventDef).toBeDefined()
    expect(eventDef.kind).toBe("event")
    expect(eventDef.elements.sideEffectSource).toBeDefined()
    expect(eventDef.elements.sideEffectSource.type).toBe("cds.String")
  })

  it("adds attachmentStatusChanged event to all services with attachments", () => {
    const services = [
      "ProcessorService",
      "AdminService",
      "ValidationTestService",
      "ValidationTestNonDraftService",
      "RestrictionService",
    ]
    for (const srv of services) {
      const eventDef = cds.model.definitions[`${srv}.attachmentStatusChanged`]
      expect(eventDef).toBeDefined()
      expect(eventDef.kind).toBe("event")
    }
  })

  it("adds @Common.SideEffects annotation to attachment entities", () => {
    const attachments =
      cds.model.definitions["ProcessorService.Incidents.attachments"]
    expect(
      attachments["@Common.SideEffects#attachmentStatusChanged.SourceEvents"],
    ).toEqual(["attachmentStatusChanged"])
    expect(
      attachments[
        "@Common.SideEffects#attachmentStatusChanged.TargetProperties"
      ],
    ).toEqual(["status"])
    expect(
      attachments["@Common.SideEffects#attachmentStatusChanged.TargetEntities"],
    ).toEqual([{ "=": "statusNav" }])
  })

  it("adds SideEffects to all attachment composition targets", () => {
    const entities = [
      "ProcessorService.Incidents.attachments",
      "ProcessorService.Incidents.hiddenAttachments",
      "ProcessorService.Customers.attachments",
      "ProcessorService.SampleRootWithComposedEntity.attachments",
      "ProcessorService.Test.attachments",
    ]
    for (const name of entities) {
      const def = cds.model.definitions[name]
      expect(
        def["@Common.SideEffects#attachmentStatusChanged.SourceEvents"],
      ).toEqual(["attachmentStatusChanged"])
    }
  })

  it("does not add duplicate SideEffects if already present", async () => {
    // The model is already loaded and enhanced; verify no duplication
    const attachments =
      cds.model.definitions["ProcessorService.Incidents.attachments"]
    const sourceEvents =
      attachments["@Common.SideEffects#attachmentStatusChanged.SourceEvents"]
    expect(sourceEvents).toEqual(["attachmentStatusChanged"])
    expect(sourceEvents).toHaveLength(1)
  })
})
