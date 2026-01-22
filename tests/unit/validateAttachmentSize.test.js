require('../../lib/csn-runtime-extension')
const cds = require('@sap/cds');
const path = require("path")
const app = path.join(__dirname, "../incidents-app")
const { axios, POST } = cds.test(app)
const fs = require('fs/promises')
const { validateAttachmentSize } = require('../../lib/generic-handlers');
const { newIncident } = require('../utils/testUtils');
const { join } = cds.utils.path

describe('validateAttachmentSize', () => {
  axios.defaults.auth = { username: "alice" }

  it('should pass validation for a file size under 400 MB', async () => {
    const incidentID = await newIncident(POST, 'admin')
    const responseCreate = await POST(
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