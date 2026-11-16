const registeredHandlers = {}

jest.mock("@sap/cds", () => {
  const actual = jest.requireActual("@sap/cds")
  const originalOn = actual.on.bind(actual)
  actual.on = jest.fn((event, fn) => {
    if (event === "served" || event === "listening") {
      registeredHandlers[event] = fn
    }
    return originalOn(event, fn)
  })
  return actual
})

describe("mtx/server.js - handler registration on served vs listening", () => {
  beforeAll(() => {
    process.env.CDS_ENV = "mtx-sidecar"
    require("../../lib/mtx/server")
  })

  it("registers its handler on 'served', not 'listening'", () => {
    expect(registeredHandlers["served"]).toBeDefined()
    expect(registeredHandlers["listening"]).toBeUndefined()
  })

  it("registers subscribe and unsubscribe handlers when the served callback runs", async () => {
    const cds = require("@sap/cds")
    const afterCalls = []

    cds.env.requires = {
      ...cds.env.requires,
      attachments: { kind: "s3", objectStore: { kind: "separate" } },
    }
    jest
      .spyOn(cds.connect, "to")
      .mockResolvedValue({ after: (event) => afterCalls.push(event) })

    await registeredHandlers["served"]()

    expect(afterCalls).toContain("subscribe")
    expect(afterCalls).toContain("unsubscribe")

    jest.restoreAllMocks()
    delete process.env.CDS_ENV
    delete cds.env.requires.attachments
  })
})
