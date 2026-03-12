const cds = require("@sap/cds")
const { RequestSend } = require("../utils/api")
const {
  waitForScanStatus,
} = require("../utils/testUtils")
const { readFileSync } = cds.utils.fs
const { join, basename } = cds.utils.path

const app = join(__dirname, "../incidents-app")
const { axios, GET, POST, PUT } = cds.test(app)
axios.defaults.auth = { username: "alice" }

let utils = null

describe("Tests for uploading/deleting attachments through API calls", () => {
  beforeAll(async () => {
    utils = new RequestSend(POST)
  })

  it("Attachment content on deeply nested comment is downloadable after draft activation with depth 3", async () => {
    const scanCleanWaiter = waitForScanStatus("Clean")

    // Create Post
    const postRes = await POST("odata/v4/processor/Posts", {
      content: "Top-level post",
    })
    const postID = postRes.data.ID

    // Create Comment
    const commentRes = await POST(
      `odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/comments`,
      { content: "First-level comment" },
    )
    const commentID = commentRes.data.ID

    // Create Reply
    const replyRes = await POST(
      `odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/comments(ID=${commentID},IsActiveEntity=false)/replies`,
      { content: "Second-level reply" },
    )
    const replyID = replyRes.data.ID

    // Add attachment to the deeply nested reply
    const filepath = join(__dirname, "content/sample.pdf")
    const filename = basename(filepath)
    const fileContent = readFileSync(filepath)

    const attachRes = await POST(
      `odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/comments(ID=${commentID},IsActiveEntity=false)/replies(ID=${replyID},IsActiveEntity=false)/attachments`,
      {
        up__ID: replyID,
        filename: filename,
        mimeType: "application/pdf",
      },
    )
    const attachmentID = attachRes.data.ID
    expect(attachmentID).toBeTruthy()

    await PUT(
      `/odata/v4/processor/Comments_attachments(up__ID=${replyID},ID=${attachmentID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: { "Content-Type": "application/pdf" },
      },
    )
     await scanCleanWaiter

    const contentResponseDraft = await GET(
      `odata/v4/processor/Comments_attachments(up__ID=${replyID},ID=${attachmentID},IsActiveEntity=false)/content`,
    )

    // Save the draft
    await POST(
      `odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/ProcessorService.draftActivate`,
    )

    // Attempt to GET the file from the deeply nested attachment
    const contentResponse = await GET(
      `odata/v4/processor/Comments_attachments(up__ID=${replyID},ID=${attachmentID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse.status).toEqual(200)
    expect(contentResponse.data).toBeTruthy()
  })
})

/**
 * Uploads attachment in draft mode using CDS test utilities
 * @param {Object} utils - RequestSend utility instance
 * @param {Object} POST - CDS test POST function
 * @param {Object} GET - CDS test GET function
 * @param {string} incidentId - Incident ID
 * @param {string} filepath - Filename for the attachment
 * @returns {Promise<string>} - Attachment ID
 */
async function uploadDraftAttachment(
  utils,
  POST,
  GET,
  incidentId,
  overrideContentLength = -1,
  entityName = "attachments",
) {
  const filepath = join(__dirname, "..", "integration", `content/sample.pdf`)

  await utils.draftModeEdit(
    "processor",
    "Incidents",
    incidentId,
    "ProcessorService",
  )

  const res = await POST(
    `odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=false)/${entityName}`,
    {
      up__ID: incidentId,
      filename: basename(filepath),
      mimeType: "application/pdf",
      createdAt: new Date(
        Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
      ),
      createdBy: "alice",
    },
  )
  const fileContent = readFileSync(filepath)
  await PUT(
    `/odata/v4/processor/Incidents_${entityName}(up__ID=${incidentId},ID=${res.data.ID},IsActiveEntity=false)/content`,
    fileContent,
    {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length":
          overrideContentLength != -1
            ? overrideContentLength
            : fileContent.byteLength,
      },
    },
  )

  await utils.draftModeSave(
    "processor",
    "Incidents",
    incidentId,
    "ProcessorService",
  )

  // Get the uploaded attachment ID
  const response = await GET(
    `odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=true)/${entityName}`,
  )
  return response.data.value[0]?.ID
}
