const path = require("path")
const fs = require("fs")
const cds = require("@sap/cds")
const { test } = cds.test()
const {
  commentAnnotation,
  uncommentAnnotation,
} = require("../utils/modify-annotation")
const { waitForScanning } = require("../utils/testUtils")

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

jest.setTimeout(5 * 60 * 1000)

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
  function createHelpers(axios) {
    return {
      createAttachmentMetadata: async (incidentID) =>
        helperCreateAttachmentMetadata(
          axios,
          incidentID,
          (filename = "sample.pdf")
        ),
      uploadAttachmentContent: async (incidentID, attachmentID, contentPath) =>
        helperUploadAttachmentContent(
          axios,
          incidentID,
          attachmentID,
          (contentPath = "content/sample.pdf")
        ),
    }
  }
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
    // Clean up test data
    await test.data.reset()
    // Close CDS connections for this test suite
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
    await waitForScanning()

    const response = await axios.get(
      `/odata/v4/processor/Incidents(ID=${incidentID})/attachments`
    )
    expect(response.status).to.equal(200)

    // Use helper function to validate structure
    validateAttachmentStructure(
      response.data.value[0],
      "sample.pdf",
      "Clean",
      incidentID
    )
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

/**
 * Helper functions for attachment testing
 */

/**
 * Creates attachment metadata for non-draft mode
 * @param {Object} axios - Axios instance
 * @param {string} incidentId - Incident ID
 * @param {string} filename - Filename for the attachment
 * @returns {Promise<string>} - Attachment ID
 */
async function helperCreateAttachmentMetadata(axios, incidentId, filename) {
  const response = await axios.post(
    `/odata/v4/processor/Incidents(${incidentId})/attachments`,
    { filename: filename },
    { headers: { "Content-Type": "application/json" } }
  )
  return response.data.ID
}

/**
 * Uploads attachment content for non-draft mode
 * @param {Object} axios - Axios instance
 * @param {string} incidentId - Incident ID
 * @param {string} attachmentId - Attachment ID
 * @param {string} contentPath - Path to content file
 * @returns {Promise<Object>} - Axios response
 */
async function helperUploadAttachmentContent(
  axios,
  incidentId,
  attachmentId,
  contentPath
) {
  const fileContent = fs.readFileSync(
    path.join(__dirname, "..", "integration", contentPath)
  )
  const response = await axios.put(
    `/odata/v4/processor/Incidents(${incidentId})/attachments(up__ID=${incidentId},ID=${attachmentId})/content`,
    fileContent,
    {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": fileContent.length,
      },
    }
  )
  return response
}

/**
 * Validates attachment response structure
 * @param {Object} attachment - Attachment object from API response
 * @param {string} expectedFilename - Expected filename
 * @param {string} expectedStatus - Expected status
 * @param {string} incidentId - Expected incident ID
 */
function validateAttachmentStructure(
  attachment,
  expectedFilename,
  expectedStatus,
  incidentId
) {
  if (attachment.up__ID !== incidentId) {
    throw new Error(
      `Expected up__ID to be ${incidentId}, got ${attachment.up__ID}`
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
}
