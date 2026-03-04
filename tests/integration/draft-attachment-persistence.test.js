const cds = require("@sap/cds")
const { RequestSend } = require("../utils/api")
const { join } = cds.utils.path

// --- Setup ---

const app = join(__dirname, "../incidents-app")
const { axios, GET, POST, PUT } = cds.test(app)
axios.defaults.auth = { username: "alice" }

// --- Helpers ---

const BASE = "/odata/v4/processor"

const Api = {
  posts: () => `${BASE}/PostsNew`,
  post: (id, active = false) =>
    `${BASE}/PostsNew(ID=${id},IsActiveEntity=${active})`,
  attachments: (postId, active = false) =>
    `${BASE}/PostsNew(ID=${postId},IsActiveEntity=${active})/attachments`,
  attachment: (postId, attachmentId, active = false) =>
    `${BASE}/PostsNew_attachments(up__ID=${postId},ID=${attachmentId},IsActiveEntity=${active})`,
  attachmentContent: (postId, attachmentId, active = false) =>
    `${BASE}/PostsNew_attachments(up__ID=${postId},ID=${attachmentId},IsActiveEntity=${active})/content`,
}

async function createEntity(url, body, headers = { "Content-Type": "application/json" }) {
  const res = await POST(url, body, { headers })
  expect(res.data.ID).toBeDefined()
  return res.data.ID
}

async function uploadContent(url, content, mimeType = "text/plain") {
  await PUT(url, content, { headers: { "Content-Type": mimeType } })
}

async function assertGet(url, check) {
  const res = await GET(url)
  expect(res.status).toBe(200)
  check?.(res)
  return res
}

// --- Domain helpers ---

const createDraftPost = () =>
  createEntity(Api.posts(), { content: "New Post" })

const createDraftAttachment = (postId) =>
  createEntity(Api.attachments(postId), {
    up__ID: postId,
    filename: "test.txt",
    mimeType: "text/plain",
  })

const uploadAttachmentContent = (postId, attachmentId, content) =>
  uploadContent(Api.attachmentContent(postId, attachmentId), content)

const verifyAttachmentList = (postId) =>
  assertGet(Api.attachments(postId), (res) => {
    expect(res.data.value).toHaveLength(1)
    expect(res.data.value[0].filename).toBe("test.txt")
  })

const verifyAttachmentContent = (postId, attachmentId, expected, active = false) =>
  assertGet(Api.attachmentContent(postId, attachmentId, active), (res) => {
    expect(res.data).toBe(expected)
  })

const verifyAttachmentRecord = (postId, attachmentId, active = false) =>
  assertGet(Api.attachment(postId, attachmentId, active))

// --- Tests ---

describe("Draft-to-Active Attachment Persistence", () => {
  let utils

  beforeAll(() => {
    utils = new RequestSend(POST)
  })

  it("should upload file in draft and persist after activation with intermediate checks", async () => {
    // 1. Create a draft post
    const postId = await createDraftPost()

    // 2. Add an attachment to the draft
    const attachmentId = await createDraftAttachment(postId)

    // 3. Upload content for the attachment
    const fileContent = "This is a test file."
    await uploadAttachmentContent(postId, attachmentId, fileContent)

    // 4. Verify attachment list and content before activation
    await verifyAttachmentList(postId)
    await verifyAttachmentContent(postId, attachmentId, fileContent)

    // 5. Activate (save) the draft
    const saveRes = await utils.draftModeSave("processor", "PostsNew", postId, "ProcessorService")
    expect([200, 201]).toContain(saveRes.status)

    // 6. Put the active entity back into edit (draft) mode
    const editRes = await utils.draftModeEdit("processor", "PostsNew", postId, "ProcessorService")
    expect([200, 201]).toContain(editRes.status)

    // 7. Verify the attachment record and content still available in draft mode after round-trip
    await verifyAttachmentRecord(postId, attachmentId)
    await verifyAttachmentContent(postId, attachmentId, fileContent)
  })
})