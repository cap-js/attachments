const cds = require("@sap/cds")
const { join } = require("path")

const app = join(__dirname, "../incidents-app")
cds.test(app)

const { buildBackAssocChain } = require("../../lib/helper")

describe("buildBackAssocChain", () => {
  let model

  beforeAll(async () => {
    model = cds.model
  })

  it("returns reversed back-association chain for depth-2 named composition (Test -> details -> attachments)", () => {
    const Test = model.definitions["ProcessorService.Test"]
    const chain = buildBackAssocChain(Test, ["details", "attachments"])
    // From attachments: up_ -> TestDetails, test -> Test
    // Reversed: ["up_", "test"]
    expect(chain).toEqual(["up_", "test"])
  })

  it("returns reversed back-association chain for depth-2 inline composition (Incidents -> conversation -> attachments)", () => {
    const Incidents = model.definitions["ProcessorService.Incidents"]
    const chain = buildBackAssocChain(Incidents, [
      "conversation",
      "attachments",
    ])
    // From attachments: up_ -> conversation, up_ -> Incidents
    // Reversed: ["up_", "up_"]
    expect(chain).toEqual(["up_", "up_"])
  })

  it("returns single-element chain for depth-1 composition (Posts -> attachments)", () => {
    const Posts = model.definitions["ProcessorService.Posts"]
    const chain = buildBackAssocChain(Posts, ["attachments"])
    // Direct child: up_ -> Posts
    // Reversed: ["up_"]
    expect(chain).toEqual(["up_"])
  })

  it("returns single-element chain for depth-1 composition (Incidents -> attachments)", () => {
    const Incidents = model.definitions["ProcessorService.Incidents"]
    const chain = buildBackAssocChain(Incidents, ["attachments"])
    expect(chain).toEqual(["up_"])
  })
})
