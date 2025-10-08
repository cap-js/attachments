const cds = require("@sap/cds")
const path = require("path")
const app = path.resolve(__dirname, "../incidents-app")
const { test } = cds.test()
const { expect, axios, GET, POST, DELETE } = require("@cap-js/cds-test")(app)
const { RequestSend } = require("../utils/api")
const { waitForScanning } = require("../utils/testUtils")
const { createReadStream } = cds.utils.fs
const { join } = cds.utils.path

axios.defaults.auth = { username: "alice" }
jest.setTimeout(5 * 60 * 1000)

let utils = null
let incidentID = null

describe("Tests for uploading/deleting attachments through API calls - in-memory db", () => {
  beforeAll(async () => {
    cds.env.requires.db.kind = "sql"
    cds.env.requires.attachments.kind = "db"
    await cds.connect.to("sql:my.db")
    await cds.connect.to("attachments")
    cds.env.requires.attachments.scan = false
    cds.env.profiles = ["development"]
    incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418"
    utils = new RequestSend(POST)
  })

  afterAll(async () => {
    try {
      // Clean up test data
      await test.data.reset()
      // Close CDS connections for this test suite
      cds.db.disconnect()
    } catch (error) {
      console.warn("Warning: Error during cleanup:", error.message)
    }
  })

  beforeEach(async () => {
    await test.data.reset()
  })

  //Draft mode uploading attachment
  it("Uploading attachment in draft mode with scanning enabled", async () => {
    let sampleDocID = null

    // Upload attachment using helper function
    sampleDocID = await uploadDraftAttachment(utils, POST, GET, incidentID)
    expect(sampleDocID).to.not.be.null

    //read attachments list for Incident
    try {
      const response = await GET(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
      )
      //the data should have only one attachment
      expect(response.status).to.equal(200)
      expect(response.data.value.length).to.equal(1)
      //to make sure content is not read
      expect(response.data.value[0].content).to.be.undefined
      sampleDocID = response.data.value[0].ID
    } catch (err) {
      expect(err).to.be.undefined
    }
    //read attachment in active table
    const response = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`
    )
    expect(response.status).to.equal(200)
    expect(response.data).to.not.be.undefined

    // Check Scanning status
    const scanResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
    )
    expect(scanResponse.status).to.equal(200)
    expect(scanResponse.data.value.length).to.equal(1)
    expect(scanResponse.data.value[0].status).to.equal("Scanning") // Initial status should be Scanning

    // Wait for scanning to complete
    await waitForScanning()

    //Check clean status
    const resultResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
    )
    expect(resultResponse.status).to.equal(200)
    expect(resultResponse.data.value.length).to.equal(1)
    expect(resultResponse.data.value[0].status).to.equal("Clean")
  })

  //Deleting the attachment
  it("Deleting the attachment", async () => {
    let sampleDocID = null

    // First upload an attachment to delete
    sampleDocID = await uploadDraftAttachment(utils, POST, GET, incidentID)
    expect(sampleDocID).to.not.be.null

    // Wait for scanning to complete
    await waitForScanning()

    //check the content of the uploaded attachment in main table
    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`
    )
    expect(contentResponse.status).to.equal(200)

    //delete attachment
    let action = await DELETE.bind(
      {},
      `odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=false)`
    )
    //trigger to delete attachment
    await utils.draftModeActions(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
      action
    )
    //read attachments list for Incident
    const response = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
    )
    //the data should have no attachments
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(0)

    //content should not be there
    await expect(
      GET(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`
      )
    ).to.be.rejectedWith(/404/)
  })
})

describe("Tests for attachments facet disable", () => {
  beforeAll(async () => {
    cds.env.requires.db.kind = "sql"
    cds.env.requires.attachments.kind = "db"
    await cds.connect.to("sql:my.db")
    await cds.connect.to("attachments")
    cds.env.requires.attachments.scan = false
    cds.env.profiles = ["development"]
    utils = new RequestSend(POST)
  })

  afterAll(async () => {
    // Close CDS connections for this test suite
    cds.db.disconnect()
  })

  it("Checking attachments facet metadata when @UI.Hidden is undefined", async () => {
    try {
      const res = await GET(`odata/v4/processor/$metadata?$format=json`)
      expect(res.status).to.equal(200)
      const facets =
        res.data.ProcessorService.$Annotations["ProcessorService.Incidents"][
          "@UI.Facets"
        ]
      const attachmentsFacetLabel = facets.some(
        (facet) => facet.Label === "Attachments"
      )
      const attachmentsFacetTarget = facets.some(
        (facet) => facet.Target === "attachments/@UI.LineItem"
      )
      expect(attachmentsFacetLabel).to.be.true
      expect(attachmentsFacetTarget).to.be.true
    } catch (err) {
      expect(err).to.be.undefined
    }
  })

  it("Checking attachments facet when @attachments.disable_facet is enabled", async () => {
    const res = await GET(`odata/v4/processor/$metadata?$format=json`)
    expect(res.status).to.equal(200)
    const facets =
      res.data.ProcessorService.$Annotations["ProcessorService.Incidents"][
        "@UI.Facets"
      ]
    const hiddenAttachmentsFacetLabel = facets.some(
      (facet) => facet.Label === "Attachments"
    )

    //Checking the facet metadata for hiddenAttachments since its annotated with @attachments.disable_facet as enabled
    const hiddenAttachmentsFacetTarget = facets.some(
      (facet) => facet.Target === "hiddenAttachments/@UI.LineItem"
    )
    expect(hiddenAttachmentsFacetLabel).to.be.true
    expect(hiddenAttachmentsFacetTarget).to.be.false
  })

  it("Checking attachments facet when @UI.Hidden is enabled", async () => {
    const res = await GET(`odata/v4/processor/$metadata?$format=json`)
    expect(res.status).to.equal(200)
    const facets =
      res.data.ProcessorService.$Annotations["ProcessorService.Incidents"][
        "@UI.Facets"
      ]
    const hiddenAttachmentsFacetLabel = facets.some(
      (facet) => facet.Label === "Attachments"
    )

    const hiddenAttachmentsFacetTarget = facets.find(
      (facet) => facet.Target === "hiddenAttachments2/@UI.LineItem"
    )
    expect(hiddenAttachmentsFacetLabel).to.be.true
    expect(!!hiddenAttachmentsFacetTarget).to.be.true
    expect(hiddenAttachmentsFacetTarget["@UI.Hidden"]).to.equal(true)
  })

  it("Attachments facet is not added when its manually added by the developer", async () => {
    const res = await GET(`odata/v4/processor/$metadata?$format=json`)
    expect(res.status).to.equal(200)
    const facets =
      res.data.ProcessorService.$Annotations["ProcessorService.Customers"][
        "@UI.Facets"
      ]

    const attachmentFacets = facets.filter(
      (facet) => facet.Target === "attachments/@UI.LineItem"
    )
    expect(attachmentFacets.length).to.equal(1)
    expect(attachmentFacets[0].Label).to.equal("My custom attachments")
  })
})

/**
 * Uploads attachment in draft mode using CDS test utilities
 * @param {Object} utils - RequestSend utility instance
 * @param {Object} POST - CDS test POST function
 * @param {Object} GET - CDS test GET function
 * @param {string} incidentId - Incident ID
 * @param {string} filename - Filename for the attachment
 * @returns {Promise<string>} - Attachment ID
 */
async function uploadDraftAttachment(
  utils,
  POST,
  GET,
  incidentId,
  filename = "sample.pdf"
) {
  const action = await POST.bind(
    {},
    `odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=false)/attachments`,
    {
      up__ID: incidentId,
      filename: filename,
      mimeType: "application/pdf",
      content: createReadStream(
        join(__dirname, "..", "integration", "content/sample.pdf")
      ),
      createdAt: new Date(
        Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
      ),
      createdBy: "alice",
    }
  )

  await utils.draftModeActions(
    "processor",
    "Incidents",
    incidentId,
    "ProcessorService",
    action
  )

  // Get the uploaded attachment ID
  const response = await GET(
    `odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=true)/attachments`
  )
  return response.data.value[0]?.ID
}
