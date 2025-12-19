require('../../lib/csn-runtime-extension')
const cds = require('@sap/cds');
const path = require("path")
const app = path.join(__dirname, "../incidents-app")
const { test, axios } = cds.test(app)
const fs = require('fs/promises')
const { validateAttachmentSize } = require('../../lib/generic-handlers');

let incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418"

describe('validateAttachmentSize', () => {
  axios.defaults.auth = { username: "alice" }
  beforeEach(async () => {
    // Clean up any existing attachments before each test
    await test.data.reset()
  })

  it('should pass validation for a file size under 400 MB', async () => {
    const responseCreate = await axios.post(
      `/odata/v4/admin/Incidents(${incidentID})/attachments`,
      { filename: 'sample.pdf' },
      { headers: { "Content-Type": "application/json" } }
    )

    const fileContent = await fs.readFile(
      path.join(__dirname, "..", "integration", 'content/sample.pdf')
    )

    const response = await axios.put(
      `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${responseCreate.data.ID})/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      }
    )

    expect(response.status).toEqual(204)
  })

  it('should reject for a file size over 400 MB', async () => {
    const req = {
      headers: { 'content-length': '20480000000' },
      data: { content: 'abc' },
      target: cds.model.definitions['AdminService.Incidents'].elements.attachments._target,
      reject: jest.fn(), // Mocking the reject function
    }
    validateAttachmentSize(req)
    expect(req.reject).toHaveBeenCalledWith({ "args": ["400MB"], "message": "AttachmentSizeExceeded", "status": 413 })
  })

  it('should reject for a file size over Validation.Maximum MB', async () => {
    const req = {
      headers: { 'content-length': '20480000000' },
      data: { content: 'abc' },
      target: cds.model.definitions['AdminService.Incidents'].elements.hiddenAttachments._target,
      reject: jest.fn(), // Mocking the reject function
    }
    validateAttachmentSize(req)
    expect(req.reject).toHaveBeenCalledWith({ "args": ["2MB"], "message": "AttachmentSizeExceeded", "status": 413 })
  })

  it('should reject when Content-Length header is missing', async () => {
    const req = {
      headers: {}, // No content-length header
      data: { content: 'abc' },
      target: cds.model.definitions['AdminService.Incidents'].elements.attachments._target,
      reject: jest.fn(), // Mocking the reject function
    }
    validateAttachmentSize(req)
    expect(req.reject).toHaveBeenCalledWith(411, 'ContentLengthHeaderMissing')
  })
})