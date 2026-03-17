const cds = require("@sap/cds")
const path = require("path")

const app = path.join(__dirname, "../incidents-app")
cds.test(app)

const ROOT = path.join(__dirname, "../..")
const { buildBackAssocChain } = require(path.join(ROOT, "lib/helper"))

describe("Verify deep nesting entities and buildBackAssocChain", () => {
  let model
  beforeAll(async () => {
    model = cds.model
  })

  it("Level0 has expected compositions", () => {
    const L0 = model.definitions["ProcessorService.Level0"]
    expect(Object.keys(L0.compositions)).toEqual(
      expect.arrayContaining(["notes", "children"]),
    )
  })

  it("Level1 has parent back-assoc and extra tags composition", () => {
    const L1 = model.definitions["ProcessorService.Level1"]
    expect(L1.elements.parent._target.name).toBe("ProcessorService.Level0")
    expect(Object.keys(L1.compositions)).toEqual(
      expect.arrayContaining(["tags", "children"]),
    )
  })

  it("Level2 has holder back-assoc and items composition", () => {
    const L2 = model.definitions["ProcessorService.Level2"]
    expect(L2.elements.holder._target.name).toBe("ProcessorService.Level1")
    expect(Object.keys(L2.compositions)).toEqual(
      expect.arrayContaining(["items", "attachments"]),
    )
  })

  it("Level3 has container back-assoc", () => {
    const L3 = model.definitions["ProcessorService.Level3"]
    expect(L3.elements.container._target.name).toBe("ProcessorService.Level2")
  })

  it("Level0 discovers depth-3 and depth-4 attachment compositions", () => {
    const L0 = model.definitions["ProcessorService.Level0"]
    const comps = L0._attachments.attachmentCompositions
    expect(comps).toEqual(
      expect.arrayContaining([
        ["children", "children", "attachments"],
        ["children", "children", "items", "attachments"],
      ]),
    )
  })

  it("buildBackAssocChain for depth-3 (Level0 -> children -> children -> attachments)", () => {
    const L0 = model.definitions["ProcessorService.Level0"]
    const chain = buildBackAssocChain(L0, [
      "children",
      "children",
      "attachments",
    ])
    // Attachment -> Level2 via up_, Level2 -> Level1 via holder, Level1 -> Level0 via parent
    expect(chain).toEqual(["up_", "holder", "parent"])
  })

  it("buildBackAssocChain for depth-4 (Level0 -> children -> children -> items -> attachments)", () => {
    const L0 = model.definitions["ProcessorService.Level0"]
    const chain = buildBackAssocChain(L0, [
      "children",
      "children",
      "items",
      "attachments",
    ])
    // Attachment -> Level3 via up_, Level3 -> Level2 via container, Level2 -> Level1 via holder, Level1 -> Level0 via parent
    expect(chain).toEqual(["up_", "container", "holder", "parent"])
  })

  it("Diamond pattern: same shared entity reachable via two paths both find attachments", () => {
    const root = model.definitions["ProcessorService.Posts"]
    const comps = root._attachments.attachmentCompositions
    expect(comps).toHaveLength(5)
    expect(comps).toEqual(
      expect.arrayContaining([
        ["attachments"],
        ["comments", "attachments"],
        ["comments", "replies", "attachments"],
        ["featured", "attachments"],
        ["featured", "replies", "attachments"],
      ]),
    )
  })
})
