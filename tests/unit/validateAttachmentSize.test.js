require("../../lib/csn-runtime-extension")
const cds = require("@sap/cds")
const { readFileSync } = cds.utils.fs
const { join } = cds.utils.path
const app = join(__dirname, "../incidents-app")
const { axios, POST } = cds.test(app)
const { validateAttachmentSize } = require("../../lib/generic-handlers")
const { newIncident } = require("../utils/testUtils")

describe("validateAttachmentSize", () => {
  axios.defaults.auth = { username: "alice" }

  it("should pass validation for a file size under 400 MB", async () => {
    const incidentID = await newIncident(POST, "admin")
    const responseCreate = await POST(
      `/odata/v4/admin/Incidents(${incidentID})/attachments`,
      { filename: "sample.pdf" },
      { headers: { "Content-Type": "application/json" } },
    )

    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )

    const response = await axios.put(
      `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${responseCreate.data.ID})/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      },
    )

    expect(response.status).toEqual(204)
  })

  it("should return when Content-Length header is missing", async () => {
    const req = {
      headers: {}, // No content-length header
      data: { content: "abc" },
      target:
        cds.model.definitions["AdminService.Incidents"].elements.attachments
          ._target,
      reject: jest.fn(), // Mocking the reject function
    }
    validateAttachmentSize(req)
    expect(req.reject).not.toHaveBeenCalled()
  })

  it("should SELECT the correct attachment by ID, not a random one from the parent", async () => {
    const target =
      cds.model.definitions["AdminService.Incidents.maximumSizeAttachments"]
    const parentID = cds.utils.uuid()
    const targetID = cds.utils.uuid()

    // Insert many decoys under the same parent so a wrong SELECT
    // (e.g. missing WHERE or wrong key) is very likely to return a decoy
    const decoys = Array.from({ length: 10 }, (_, i) => ({
      up__ID: parentID,
      ID: cds.utils.uuid(),
      filename: `decoy-${i + 1}.pdf`,
      status: "Scanning",
    }))

    await INSERT.into(target).entries([
      ...decoys.slice(0, 5),
      {
        up__ID: parentID,
        ID: targetID,
        filename: "target-file.pdf",
        status: "Scanning",
      },
      ...decoys.slice(5),
    ])

    const req = {
      target,
      data: {
        content: { pause: jest.fn() },
        up__ID: parentID,
        ID: targetID,
      },
      headers: { "content-length": "999999999999" },
      reject: jest.fn(),
    }

    await validateAttachmentSize(req)

    expect(req.reject).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 413,
        message: "AttachmentSizeExceeded",
        args: ["target-file.pdf", "5MB"],
      }),
    )
  })
})
