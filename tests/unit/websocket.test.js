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
        `^/Incidents\\(ID=${keys.up__ID},IsActiveEntity=false\\)$`,
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
        `^/Incidents\\(ID=${keys.up__ID},IsActiveEntity=true\\)$`,
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

  it("constructs correct sideEffectSource path targeting parent entity", async () => {
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
    // Should NOT contain attachment child path
    expect(source).not.toContain("/attachments(")
    // Should contain parent key
    expect(source).toContain(`ID=${keys.up__ID}`)
    // Should NOT contain attachment ID in path
    expect(source).not.toContain(`ID=${keys.ID}`)
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

  it("adds @Common.SideEffects annotation to parent entities targeting attachment compositions", () => {
    const incidents =
      cds.model.definitions["ProcessorService.Incidents"]
    const sideEffects = incidents["@Common.SideEffects#attachmentStatusChanged_attachments"]
    expect(sideEffects).toBeDefined()
    expect(sideEffects.SourceEvents).toEqual(["attachmentStatusChanged"])
    expect(sideEffects.TargetEntities).toEqual([{ "=": "attachments" }])
    // TargetProperties should not be set
    expect(sideEffects.TargetProperties).toBeUndefined()
  })

  it("adds SideEffects to parent entities for all attachment compositions", () => {
    // Parent entities should have SideEffects with qualifier per composition
    const incidents = cds.model.definitions["ProcessorService.Incidents"]
    const compositionNames = [
      "attachments",
      "hiddenAttachments",
    ]
    for (const compName of compositionNames) {
      const qualifier = `attachmentStatusChanged_${compName}`
      const sideEffects = incidents[`@Common.SideEffects#${qualifier}`]
      expect(sideEffects).toBeDefined()
      expect(sideEffects.SourceEvents).toEqual(["attachmentStatusChanged"])
      expect(sideEffects.TargetEntities).toEqual([{ "=": compName }])
    }

    const customers = cds.model.definitions["ProcessorService.Customers"]
    const custSideEffects = customers["@Common.SideEffects#attachmentStatusChanged_attachments"]
    expect(custSideEffects).toBeDefined()
    expect(custSideEffects.SourceEvents).toEqual(["attachmentStatusChanged"])
    expect(custSideEffects.TargetEntities).toEqual([{ "=": "attachments" }])
  })

  it("does not add duplicate SideEffects if already present", async () => {
    // The model is already loaded and enhanced; verify no duplication
    const incidents =
      cds.model.definitions["ProcessorService.Incidents"]
    const sideEffects = incidents["@Common.SideEffects#attachmentStatusChanged_attachments"]
    expect(sideEffects).toBeDefined()
    expect(sideEffects.SourceEvents).toEqual(["attachmentStatusChanged"])
    expect(sideEffects.SourceEvents).toHaveLength(1)
  })
})
