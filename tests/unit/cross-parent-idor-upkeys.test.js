"use strict"
require("../../lib/csn-runtime-extension")
const cds = require("@sap/cds")
const path = require("path")
const { withUser, newIncident } = require("../utils/testUtils")

const app = path.resolve(__dirname, "../incidents-app")

// Two users: alice creates an incident; bob tries to plant an attachment on it
const aliceTest = cds.test(app)
const { GET, POST } = withUser("alice", aliceTest)
const { POST: bobPOST, GET: bobGET } = withUser("bob", aliceTest)

let aliceIncidentID
let bobIncidentID

beforeAll(async () => {
  aliceIncidentID = await newIncident(POST, "processor")
  bobIncidentID = await newIncident(bobPOST, "processor")
}, 30000)

afterAll(async () => {
  await cds.disconnect()
})

describe("cross-parent IDOR via body up__ keys", () => {
  it("baseline: alice can create an attachment on her own incident via navigation", async () => {
    const res = await POST(
      `odata/v4/processor/Incidents(ID=${aliceIncidentID},IsActiveEntity=false)/attachments`,
      { filename: "legit.pdf", mimeType: "application/pdf" },
    )
    expect(res.status).toBe(201)
  })

  it("bob cannot plant an attachment on alice's incident by injecting up__ID in the body", async () => {
    // Bob POSTs to his OWN incident URL but injects alice's incidentID as up__ID in the body.
    // Without the fix: hasUpKey guard sees up__ID in body and skips URL-derived parent lookup,
    // so the attachment is created with up__ID = aliceIncidentID (cross-parent IDOR).
    // With the fix: URL-derived parent key overwrites the body-supplied up__ID,
    // so the attachment goes to bob's incident (or the SELECT validates correctly).
    const res = await bobPOST(
      `odata/v4/processor/Incidents(ID=${bobIncidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: aliceIncidentID, // injected: bob's request body claims alice's incident
        filename: "injected.pdf",
        mimeType: "application/pdf",
      },
      { validateStatus: () => true },
    )
    // Request should succeed (bob owns his incident), but the attachment must be on BOB's incident
    if (res.status === 201) {
      // The returned up__ID must be bob's, not alice's
      expect(res.data.up__ID).not.toBe(aliceIncidentID)
    }
  })

  it("alice's incident has no injected attachments after bob's attempt", async () => {
    // Bob attempts the injection again and then we check alice's incident has no new attachments
    await bobPOST(
      `odata/v4/processor/Incidents(ID=${bobIncidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: aliceIncidentID,
        filename: "injected2.pdf",
        mimeType: "application/pdf",
      },
      { validateStatus: () => true },
    )
    const res = await GET(
      `odata/v4/processor/Incidents(ID=${aliceIncidentID},IsActiveEntity=false)/attachments`,
      { validateStatus: () => true },
    )
    const injected = (res.data?.value ?? []).filter((a) =>
      a.filename?.includes("injected"),
    )
    expect(injected).toHaveLength(0)
  })

  it("client-supplied attachment ID is ignored on CREATE", async () => {
    const chosenID = cds.utils.uuid()
    const res = await POST(
      `odata/v4/processor/Incidents(ID=${aliceIncidentID},IsActiveEntity=false)/attachments`,
      { ID: chosenID, filename: "chosen-id.pdf", mimeType: "application/pdf" },
      { validateStatus: () => true },
    )
    if (res.status === 201) {
      expect(res.data.ID).not.toBe(chosenID)
    }
  })
})
