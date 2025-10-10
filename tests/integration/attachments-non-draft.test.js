const path = require("path")
const fs = require("fs")
const cds = require("@sap/cds")
const { test } = cds.test()
const {
  commentAnnotation,
  uncommentAnnotation,
} = require("../utils/modify-annotation")
const { delay } = require("../utils/testUtils")

const servicesCdsPath = path.resolve(
  __dirname,
  "../incidents-app/srv/services.cds"
)
const annotationsCdsPath = path.resolve(
  __dirname,
  "../incidents-app/app/incidents/annotations.cds"
)
const linesToComment = [
  "annotate ProcessorService.Incidents with @odata.draft.enabled",
  "annotate service.Incidents with @odata.draft.enabled",
]

beforeAll(async () => {
  await commentAnnotation(servicesCdsPath, linesToComment)
  await commentAnnotation(annotationsCdsPath, linesToComment)
})

const app = path.resolve(__dirname, "../incidents-app")
const { expect, axios } = require("@cap-js/cds-test")(app)

let incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418"

afterAll(async () => {
  try {
    await uncommentAnnotation(servicesCdsPath, linesToComment)
    await uncommentAnnotation(annotationsCdsPath, linesToComment)

    // Close any remaining CDS connections
    cds.disconnect()
  } catch (error) {
    console.warn("Warning: Error during cleanup:", error.message)
  }
})

describe("Tests for uploading/deleting and fetching attachments through API calls with non draft mode", () => {
  axios.defaults.auth = { username: "alice" }
  const { createAttachmentMetadata, uploadAttachmentContent } =
    createHelpers(axios)

  beforeAll(async () => {
    cds.env.requires.db.kind = "sql"
    cds.env.requires.attachments.kind = "db"
    await cds.connect.to("sql:my.db")
    await cds.connect.to("attachments")
    cds.env.requires.attachments.scan = false
    cds.env.profiles = ["development"]
  })

  afterAll(async () => {
    // Clean up test data & Close CDS connections for this test suite
    await test.data.reset()
    cds.db.disconnect()
  })

  beforeEach(async () => {
    // Clean up any existing attachments before each test
    await test.data.reset()
  })

  it("should create attachment metadata", async () => {
    const attachmentID = await createAttachmentMetadata(incidentID)
    expect(attachmentID).to.exist
  })

  it("should upload attachment content", async () => {
    const attachmentID = await createAttachmentMetadata(incidentID)
    const response = await uploadAttachmentContent(incidentID, attachmentID)
    expect(response.status).to.equal(204)
  })

  it("should list attachments for incident", async () => {
    const attachmentID = await createAttachmentMetadata(incidentID)
    await uploadAttachmentContent(incidentID, attachmentID)

    // Wait for scanning to complete
    await delay()

    const response = await axios.get(
      `/odata/v4/processor/Incidents(ID=${incidentID})/attachments`
    )
    expect(response.status).to.equal(200)

    const expectedFilename = "sample.pdf"
    const expectedStatus = "Clean"
    const attachment = response.data.value[0]
    if (attachment.up__ID !== incidentID) {
    throw new Error(
      `Expected up__ID to be ${incidentID}, got ${attachment.up__ID}`
    )
  }
  if (attachment.filename !== expectedFilename) {
    throw new Error(
      `Expected filename to be ${expectedFilename}, got ${attachment.filename}`
    )
  }
  if (attachment.status !== expectedStatus) {
    throw new Error(
      `Expected status to be ${expectedStatus}, got ${attachment.status}`
    )
  }
  if (attachment.content !== undefined) {
    throw new Error("Content should not be included in list responses")
  }

    expect(response.data.value[0].ID).to.equal(attachmentID)
  })

  it("Fetching the content of the uploaded attachment", async () => {
    const attachmentID = await createAttachmentMetadata(incidentID)
    await uploadAttachmentContent(incidentID, attachmentID)

    // Wait for scanning to complete
    await waitForScanning()

    const response = await axios.get(
      `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`,
      { responseType: "arraybuffer" }
    )
    expect(response.status).to.equal(200)
    expect(response.data).to.exist
    expect(response.data.length).to.be.greaterThan(0)

    const originalContent = fs.readFileSync(
      path.join(__dirname, "content/sample.pdf")
    )
    expect(Buffer.compare(response.data, originalContent)).to.equal(0)
  })

  it("should delete attachment and verify deletion", async () => {
    const attachmentID = await createAttachmentMetadata(incidentID)
    await uploadAttachmentContent(incidentID, attachmentID)

    // Wait for scanning to complete
    await waitForScanning()

    // Delete the attachment
    const deleteResponse = await axios.delete(
      `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
    )
    expect(deleteResponse.status).to.equal(204)

    // Verify the attachment is deleted
    try {
      await axios.get(
        `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
      )
      // Should not reach here
      expect.fail("Expected 404 error")
    } catch (err) {
      expect(err.response.status).to.equal(404)
    }
  })
})

function createHelpers(axios) {
  return {
    createAttachmentMetadata: async (incidentID, filename = "sample.pdf") => {
      const response = await axios.post(
        `/odata/v4/processor/Incidents(${incidentID})/attachments`,
        { filename: filename },
        { headers: { "Content-Type": "application/json" } }
      )
      return response.data.ID
    },
    uploadAttachmentContent: async (
      incidentID,
      attachmentID,
      contentPath = "content/sample.pdf"
    ) => {
      const fileContent = fs.readFileSync(
        path.join(__dirname, "..", "integration", contentPath)
      )
      const response = await axios.put(
        `/odata/v4/processor/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`,
        fileContent,
        {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": fileContent.length,
          },
        }
      )
      return response
    },
  }
}
