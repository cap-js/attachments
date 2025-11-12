const path = require("path")
const fs = require("fs")
const cds = require("@sap/cds")
const { test } = cds.test()
const { waitForScanStatus } = require("../utils/testUtils")

const app = path.resolve(__dirname, "../incidents-app")
const { expect, axios } = require("@cap-js/cds-test")(app)

let incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418"

describe("Tests for uploading/deleting and fetching attachments through API calls with non draft mode", () => {
  axios.defaults.auth = { username: "alice" }
  const { createAttachmentMetadata, uploadAttachmentContent } =
    createHelpers(axios)

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

  it("should fail to upload attachment to non-existent entity", async () => {
    try {
      await uploadAttachmentContent(incidentID, cds.utils.uuid())
      expect.fail("Expected 404 error")
    } catch (err) {
      expect(err.response.status).to.equal(404)
    }
  })

  it("should fail to update note for non-existent attachment", async () => {
    try {
      await axios.patch(
        `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${cds.utils.uuid()})`,
        { note: "This should fail" },
        { headers: { "Content-Type": "application/json" } }
      )
      expect.fail("Expected 404 error")
    } catch (err) {
      expect(err.response.status).to.equal(404)
    }
  })

  it("should list attachments for incident", async () => {

    const attachmentID = await createAttachmentMetadata(incidentID)
    const scanCleanWaiter = waitForScanStatus('Clean', attachmentID)
    await uploadAttachmentContent(incidentID, attachmentID)

    // Wait for scanning to complete
    await scanCleanWaiter

    const response = await axios.get(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments`
    )
    expect(response.status).to.equal(200)

    const attachment = response.data.value[0]

    expect(attachment.up__ID).to.equal(incidentID)
    expect(attachment.filename).to.equal("sample.pdf")
    expect(attachment.status).to.equal("Clean")
    expect(attachment.content).to.be.undefined
    expect(response.data.value[0].ID).to.equal(attachmentID)
  })

  it("Fetching the content of the uploaded attachment", async () => {

    const attachmentID = await createAttachmentMetadata(incidentID)
    const scanCleanWaiter = waitForScanStatus('Clean', attachmentID)
    await uploadAttachmentContent(incidentID, attachmentID)

    // Wait for scanning to complete
    await scanCleanWaiter

    const response = await axios.get(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`,
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
    const scanCleanWaiter = waitForScanStatus('Clean', attachmentID)
    await uploadAttachmentContent(incidentID, attachmentID)

    // Wait for scanning to complete
    await scanCleanWaiter

    // Delete the attachment
    const deleteResponse = await axios.delete(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
    )
    expect(deleteResponse.status).to.equal(204)

    // Verify the attachment is deleted
    try {
      await axios.get(
        `/odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
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
        `/odata/v4/admin/Incidents(${incidentID})/attachments`,
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
        `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`,
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
