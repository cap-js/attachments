const cds = require("@sap/cds")
const { RequestSend } = require("../utils/api")
const {
  waitForScanStatus,
  newIncident,
  runWithUser,
  uploadDraftAttachment,
} = require("../utils/testUtils")
const path = require("path")

const app = path.resolve(__dirname, "../incidents-app")
const { axios, GET, POST, DELETE, PUT } = cds.test(app)
axios.defaults.auth = { username: "alice" }
const alice = new cds.User({ id: "alice", roles: { admin: 1, support: 1 } })
const { readFileSync } = cds.utils.fs
const { join, basename } = cds.utils.path

let utils = null

describe("Tests for renaming duplicate attachments", () => {
  let originalDeduplicateFileNames

  beforeAll(async () => {
    utils = new RequestSend(POST)
    originalDeduplicateFileNames =
      cds.env.requires.attachments.deduplicateFileNames
    cds.env.requires.attachments.deduplicateFileNames = true
  })

  afterAll(() => {
    cds.env.requires.attachments.deduplicateFileNames =
      originalDeduplicateFileNames
  })

  it("Should rename duplicate attachments when both are added to same draft", async () => {
    const incidentID = await newIncident(POST, "processor")

    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const filepath = join(__dirname, "..", "integration", `content/sample.pdf`)
    // Upload first attachment
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: basename(filepath),
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )

    // Upload second attachment with the same name
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: basename(filepath),
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )

    // Upload third attachment with the same name
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: basename(filepath),
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )

    const draftResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
    )
    expect(draftResponse.status).toEqual(200)
    expect(draftResponse.data.value.length).toEqual(3)
    const draftFilenames = draftResponse.data.value
      .map((attachment) => attachment.filename)
      .sort()
    expect(draftFilenames).toEqual([
      "sample-1.pdf",
      "sample-2.pdf",
      "sample.pdf",
    ])

    await utils.draftModeSave(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const finalResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )

    expect(finalResponse.status).toEqual(200)
    expect(finalResponse.data.value.length).toEqual(3)

    const filenames = finalResponse.data.value
      .map((attachment) => attachment.filename)
      .sort()
    expect(filenames).toEqual(["sample-1.pdf", "sample-2.pdf", "sample.pdf"])
  })

  it("Should rename duplicate attachments when first one has been saved", async () => {
    const incidentID = await newIncident(POST, "processor")

    // Upload first attachment
    await uploadDraftAttachment(utils, POST, PUT, GET, incidentID)

    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const filepath = join(__dirname, "..", "integration", `content/sample.pdf`)
    // Upload second attachment with the same name
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: basename(filepath),
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )

    const draftResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
    )
    expect(draftResponse.status).toEqual(200)
    expect(draftResponse.data.value.length).toEqual(2)
    const draftFilenames = draftResponse.data.value
      .map((attachment) => attachment.filename)
      .sort()
    expect(draftFilenames).toEqual(["sample-1.pdf", "sample.pdf"])

    await utils.draftModeSave(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const finalResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )

    expect(finalResponse.status).toEqual(200)
    expect(finalResponse.data.value.length).toEqual(2)

    const filenames = finalResponse.data.value
      .map((attachment) => attachment.filename)
      .sort()
    expect(filenames).toEqual(["sample-1.pdf", "sample.pdf"])
  })

  it("Should rename duplicate attachments when they already end with -1", async () => {
    const incidentID = await newIncident(POST, "processor")

    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const initialFilename = "sample-1.pdf"
    // Upload first attachment
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: initialFilename,
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )

    // Upload second attachment with the same name
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: initialFilename,
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )

    // Upload third attachment with the same name
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: initialFilename,
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )

    const draftResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
    )
    expect(draftResponse.status).toEqual(200)
    expect(draftResponse.data.value.length).toEqual(3)
    const draftFilenames = draftResponse.data.value
      .map((attachment) => attachment.filename)
      .sort()
    expect(draftFilenames).toEqual([
      "sample-1-1.pdf",
      "sample-1-2.pdf",
      "sample-1.pdf",
    ])

    await utils.draftModeSave(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const finalResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )

    expect(finalResponse.status).toEqual(200)
    expect(finalResponse.data.value.length).toEqual(3)

    const filenames = finalResponse.data.value
      .map((attachment) => attachment.filename)
      .sort()
    expect(filenames).toEqual([
      "sample-1-1.pdf",
      "sample-1-2.pdf",
      "sample-1.pdf",
    ])
  })

  it("Should rename duplicate attachments on a parent with a composite key", async () => {
    const key = { sampleID: `COMPKEY-${cds.utils.uuid()}`, gjahr: 2026 }
    const { data: parent } = await POST(
      "/odata/v4/processor/SampleRootWithComposedEntity",
      key,
    )
    expect(parent.IsActiveEntity).toBe(false)

    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)

    const { data: attachment1 } = await POST(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key.sampleID}',gjahr=${key.gjahr},IsActiveEntity=false)/attachments`,
      {
        filename: basename(filepath),
        mimeType: "application/pdf",
      },
    )

    await PUT(
      `/odata/v4/processor/SampleRootWithComposedEntity_attachments(up__sampleID='${key.sampleID}',up__gjahr=${key.gjahr},ID=${attachment1.ID},IsActiveEntity=false)/content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )

    await POST(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key.sampleID}',gjahr=${key.gjahr},IsActiveEntity=false)/ProcessorService.draftActivate`,
    )

    // Start a new draft session to add another file
    await POST(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key.sampleID}',gjahr=${key.gjahr},IsActiveEntity=true)/ProcessorService.draftEdit`,
    )

    const { data: attachment2 } = await POST(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key.sampleID}',gjahr=${key.gjahr},IsActiveEntity=false)/attachments`,
      {
        filename: basename(filepath),
        mimeType: "application/pdf",
      },
    )

    await PUT(
      `/odata/v4/processor/SampleRootWithComposedEntity_attachments(up__sampleID='${key.sampleID}',up__gjahr=${key.gjahr},ID=${attachment2.ID},IsActiveEntity=false)/content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )

    await POST(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key.sampleID}',gjahr=${key.gjahr},IsActiveEntity=false)/ProcessorService.draftActivate`,
    )

    const { data: allAttachments } = await GET(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key.sampleID}',gjahr=${key.gjahr},IsActiveEntity=true)/attachments`,
    )

    expect(allAttachments.value).toHaveLength(2)
    const filenames = allAttachments.value.map((a) => a.filename).sort()
    expect(filenames).toEqual(["sample-1.pdf", "sample.pdf"])
  })

  it("Should NOT rename attachments on different parents that share a partial composite key", async () => {
    // Two parents sharing the same sampleID but different gjahr - these are distinct records
    const sharedSampleID = `SHARED-${cds.utils.uuid().substring(0, 8)}`
    const key1 = { sampleID: sharedSampleID, gjahr: 2025 }
    const key2 = { sampleID: sharedSampleID, gjahr: 2026 }
    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)

    await POST("/odata/v4/processor/SampleRootWithComposedEntity", key1)
    const { data: att1 } = await POST(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key1.sampleID}',gjahr=${key1.gjahr},IsActiveEntity=false)/attachments`,
      { filename: basename(filepath), mimeType: "application/pdf" },
    )
    await PUT(
      `/odata/v4/processor/SampleRootWithComposedEntity_attachments(up__sampleID='${key1.sampleID}',up__gjahr=${key1.gjahr},ID=${att1.ID},IsActiveEntity=false)/content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )
    await POST(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key1.sampleID}',gjahr=${key1.gjahr},IsActiveEntity=false)/ProcessorService.draftActivate`,
    )

    // Create second parent (same sampleID, different gjahr) and upload sample.pdf
    await POST("/odata/v4/processor/SampleRootWithComposedEntity", key2)
    const { data: att2 } = await POST(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key2.sampleID}',gjahr=${key2.gjahr},IsActiveEntity=false)/attachments`,
      { filename: basename(filepath), mimeType: "application/pdf" },
    )
    await PUT(
      `/odata/v4/processor/SampleRootWithComposedEntity_attachments(up__sampleID='${key2.sampleID}',up__gjahr=${key2.gjahr},ID=${att2.ID},IsActiveEntity=false)/content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )
    await POST(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key2.sampleID}',gjahr=${key2.gjahr},IsActiveEntity=false)/ProcessorService.draftActivate`,
    )

    // Verify parent 2's attachment was NOT renamed - it's a different parent record
    const { data: result } = await GET(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key2.sampleID}',gjahr=${key2.gjahr},IsActiveEntity=true)/attachments`,
    )
    expect(result.value).toHaveLength(1)
    expect(result.value[0].filename).toEqual("sample.pdf") // Should NOT be "sample-1.pdf"
  })

  it("Should NOT rename attachment when two parents with same partial key are both in draft", async () => {
    const sharedSampleID = `SHARED-${Math.round(Math.random() * 1000)}`
    const key1 = { sampleID: sharedSampleID, gjahr: 2025 }
    const key2 = { sampleID: sharedSampleID, gjahr: 2026 }
    const filepath = join(__dirname, "content/sample.pdf")

    // Create parent 1 and upload - but do NOT activate
    await POST("/odata/v4/processor/SampleRootWithComposedEntity", key1)
    await POST(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key1.sampleID}',gjahr=${key1.gjahr},IsActiveEntity=false)/attachments`,
      { filename: basename(filepath), mimeType: "application/pdf" },
    )

    // Create parent 2 while parent 1 is still in draft
    await POST("/odata/v4/processor/SampleRootWithComposedEntity", key2)
    const { data: att2 } = await POST(
      `/odata/v4/processor/SampleRootWithComposedEntity(sampleID='${key2.sampleID}',gjahr=${key2.gjahr},IsActiveEntity=false)/attachments`,
      { filename: basename(filepath), mimeType: "application/pdf" },
    )

    // Should be "sample.pdf" - but with the bug it will be "sample-1.pdf"
    expect(att2.filename).toEqual("sample.pdf")
  })

  it("Should rename duplicate attachments in a non-default composition field (overwritableAttachments)", async () => {
    const incidentID = await newIncident(POST, "processor")

    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const filepath = join(__dirname, "..", "integration", `content/sample.pdf`)
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/overwritableAttachments`,
      {
        up__ID: incidentID,
        filename: basename(filepath),
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/overwritableAttachments`,
      {
        up__ID: incidentID,
        filename: basename(filepath),
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )

    const response = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/overwritableAttachments`,
    )
    expect(response.data.value.map((a) => a.filename).sort()).toEqual([
      "sample-1.pdf",
      "sample.pdf",
    ])
  })

  it("Should rename duplicates independently across multiple attachment compositions on the same entity", async () => {
    const incidentID = await newIncident(POST, "processor")

    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const filepath = join(__dirname, "..", "integration", `content/sample.pdf`)
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: basename(filepath),
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: basename(filepath),
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/overwritableAttachments`,
      {
        up__ID: incidentID,
        filename: basename(filepath),
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/overwritableAttachments`,
      {
        up__ID: incidentID,
        filename: basename(filepath),
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )

    const attachmentsRes = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
    )
    const overwritableRes = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/overwritableAttachments`,
    )
    expect(attachmentsRes.data.value.map((a) => a.filename).sort()).toEqual([
      "sample-1.pdf",
      "sample.pdf",
    ])
    expect(overwritableRes.data.value.map((a) => a.filename).sort()).toEqual([
      "sample-1.pdf",
      "sample.pdf",
    ])
  })

  it("Should NOT rename duplicates when deduplicateFileNames option is disabled", async () => {
    cds.env.requires.attachments.deduplicateFileNames = false

    try {
      const incidentID = await newIncident(POST, "processor")

      await utils.draftModeEdit(
        "processor",
        "Incidents",
        incidentID,
        "ProcessorService",
      )

      const filepath = join(
        __dirname,
        "..",
        "integration",
        `content/sample.pdf`,
      )
      // Upload first attachment
      await POST(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
        {
          up__ID: incidentID,
          filename: basename(filepath),
          mimeType: "application/pdf",
          createdAt: new Date(),
          createdBy: "alice",
        },
      )

      // Upload second attachment with the same name
      const { data: secondAttachment } = await POST(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
        {
          up__ID: incidentID,
          filename: basename(filepath),
          mimeType: "application/pdf",
          createdAt: new Date(),
          createdBy: "alice",
        },
      )

      // With deduplicateFileNames disabled, filename should remain unchanged
      expect(secondAttachment.filename).toEqual("sample.pdf")

      const draftResponse = await GET(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      )
      expect(draftResponse.data.value.length).toEqual(2)
      const filenames = draftResponse.data.value
        .map((attachment) => attachment.filename)
        .sort()
      // Both should keep the original name since dedup is off
      expect(filenames).toEqual(["sample.pdf", "sample.pdf"])
    } finally {
      cds.env.requires.attachments.deduplicateFileNames = true
    }
  })
})

describe("Testing to prevent crash due to recursive overflow", () => {
  it("Should not crash and allow attachment upload with recursive compositions", async () => {
    const postData = await POST(
      "/odata/v4/processor/Posts",
      {
        content: "New Post",
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
    expect(postData.data.ID).toBeDefined()

    const postID = postData.data.ID
    const attachmentData = await POST(
      `/odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/attachments`,
      {
        up__ID: postID,
        filename: "test.txt",
        mimeType: "text/plain",
      },
    )
    expect(attachmentData.data.ID).toBeDefined()

    const attachmentID = attachmentData.data.ID
    await PUT(
      `/odata/v4/processor/Posts_attachments(up__ID=${postID},ID=${attachmentID},IsActiveEntity=false)/content`,
      "This is a test attachment.",
      { headers: { "Content-Type": "text/plain" } },
    )

    const attachments = await GET(
      `/odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/attachments`,
    )
    expect(attachments.data.value).toHaveLength(1)
    expect(attachments.data.value[0].filename).toBe("test.txt")
  })

  it("Should not crash when activating a draft with deeply nested recursive compositions", async () => {
    // This test verifies that the attachment discovery mechanism can handle
    // deeply nested, recursive compositions without causing a stack overflow.
    // The structure is Post -> comments(Comment) -> replies(Comment) -> ...

    // Create a draft Post
    const postRes = await POST("/odata/v4/processor/Posts", {
      content: "Post with nested comments",
    })
    const postID = postRes.data.ID
    expect(postID).toBeDefined()

    // Create a nested Comment
    const commentRes = await POST(
      `/odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/comments`,
      { content: "Level 1 Comment" },
    )
    const commentID = commentRes.data.ID
    expect(commentID).toBeDefined()

    // Create a deeply nested Reply (a Comment on a Comment)
    const replyRes = await POST(
      `/odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/comments(ID=${commentID},IsActiveEntity=false)/replies`,
      { content: "Level 2 Reply" },
    )
    const replyID = replyRes.data.ID
    expect(replyID).toBeDefined()

    let activationResponse
    let responseError
    try {
      activationResponse = await POST(
        `/odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/ProcessorService.draftActivate`,
      )
    } catch (e) {
      // Fail the test explicitly if an error is thrown
      responseError = e
    }
    expect(responseError).not.toBeTruthy()
    expect(activationResponse.status).toEqual(201)
    expect(activationResponse.data.ID).toEqual(postID)
  })

  it("Attachments at multiple nesting levels are all saved on draft activation", async () => {
    const postRes = await POST("odata/v4/processor/Posts", { content: "Post" })
    const postID = postRes.data.ID

    // Attachment on the root Post itself
    const postAttRes = await POST(
      `odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/attachments`,
      { up__ID: postID, filename: "post.pdf", mimeType: "application/pdf" },
    )
    const postScanWaiter = waitForScanStatus("Clean", postAttRes.data.ID)
    const fileContent = readFileSync(join(__dirname, "content/sample.pdf"))
    await PUT(
      `/odata/v4/processor/Posts_attachments(up__ID=${postID},ID=${postAttRes.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )

    // Attachment on a nested reply
    const commentRes = await POST(
      `odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/comments`,
      { content: "Comment" },
    )
    const replyRes = await POST(
      `odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/comments(ID=${commentRes.data.ID},IsActiveEntity=false)/replies`,
      { content: "Reply" },
    )
    const replyAttRes = await POST(
      `odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/comments(ID=${commentRes.data.ID},IsActiveEntity=false)/replies(ID=${replyRes.data.ID},IsActiveEntity=false)/attachments`,
      {
        up__ID: replyRes.data.ID,
        filename: "reply.pdf",
        mimeType: "application/pdf",
      },
    )
    const replyScanWaiter = waitForScanStatus("Clean", replyAttRes.data.ID)
    await PUT(
      `/odata/v4/processor/Comments_attachments(up__ID=${replyRes.data.ID},ID=${replyAttRes.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )

    await POST(
      `odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/ProcessorService.draftActivate`,
    )

    await Promise.all([postScanWaiter, replyScanWaiter])

    // Both should be accessible on the active entity
    const postContent = await GET(
      `odata/v4/processor/Posts_attachments(up__ID=${postID},ID=${postAttRes.data.ID},IsActiveEntity=true)/content`,
    )
    expect(postContent.status).toEqual(200)

    const replyContent = await GET(
      `odata/v4/processor/Comments_attachments(up__ID=${replyRes.data.ID},ID=${replyAttRes.data.ID},IsActiveEntity=true)/content`,
    )
    expect(replyContent.status).toEqual(200)
  })

  it("Canceling a draft removes unsaved reply attachments", async () => {
    const postRes = await POST("odata/v4/processor/Posts", { content: "Post" })
    const postID = postRes.data.ID

    const commentRes = await POST(
      `odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/comments`,
      { content: "Comment" },
    )
    const replyRes = await POST(
      `odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/comments(ID=${commentRes.data.ID},IsActiveEntity=false)/replies`,
      { content: "Reply" },
    )
    const replyAttRes = await POST(
      `odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)/comments(ID=${commentRes.data.ID},IsActiveEntity=false)/replies(ID=${replyRes.data.ID},IsActiveEntity=false)/attachments`,
      {
        up__ID: replyRes.data.ID,
        filename: "reply.pdf",
        mimeType: "application/pdf",
      },
    )
    const fileContent = readFileSync(join(__dirname, "content/sample.pdf"))
    await PUT(
      `/odata/v4/processor/Comments_attachments(up__ID=${replyRes.data.ID},ID=${replyAttRes.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )

    // Discard the draft
    await DELETE(`odata/v4/processor/Posts(ID=${postID},IsActiveEntity=false)`)

    // The active entity should have no attachment content
    let errorThrown
    await GET(
      `odata/v4/processor/Comments_attachments(up__ID=${replyRes.data.ID},ID=${replyAttRes.data.ID},IsActiveEntity=true)/content`,
    ).catch((e) => {
      errorThrown = e
    })
    expect(errorThrown.response.status).toEqual(404)
  })
})

describe("Tests for copy() on AttachmentsService", () => {
  beforeAll(async () => {
    utils = new RequestSend(POST)
  })

  it("Copies a clean attachment to a different incident", async () => {
    const sourceIncidentID = await newIncident(POST, "processor")
    const targetIncidentID = await newIncident(POST, "processor")
    const sourceCleanWaiter = waitForScanStatus("Clean")

    const sourceAttachmentID = await uploadDraftAttachment(
      utils,
      POST,
      PUT,
      GET,
      sourceIncidentID,
    )
    expect(sourceAttachmentID).toBeTruthy()
    await utils.draftModeSave(
      "processor",
      "Incidents",
      targetIncidentID,
      "ProcessorService",
    )
    await sourceCleanWaiter

    const AttachmentsSrv = await cds.connect.to("attachments")
    const { ProcessorService } = cds.services
    const Attachments = ProcessorService.entities["Incidents.attachments"]

    const newAtt = await runWithUser(alice, () =>
      AttachmentsSrv.copy(
        Attachments,
        { ID: sourceAttachmentID },
        Attachments,
        { up__ID: targetIncidentID },
      ),
    )
    expect(newAtt.ID).not.toEqual(sourceAttachmentID)
    expect(newAtt.url).toBeTruthy()
    expect(newAtt.filename).toEqual("sample.pdf")
    expect(newAtt.mimeType).toBeTruthy()
    expect(newAtt.hash).toBeTruthy()
    // Scan status is inherited from source — no re-scan needed
    expect(newAtt.status).toEqual("Clean")

    // Verify the copied record is in the DB under the target incident
    const copied = await GET(
      `odata/v4/processor/Incidents(ID=${targetIncidentID},IsActiveEntity=true)/attachments`,
    )
    expect(copied.status).toEqual(200)
    expect(copied.data.value.length).toEqual(1)
    expect(copied.data.value[0].ID).toEqual(newAtt.ID)
    expect(copied.data.value[0].filename).toEqual("sample.pdf")

    // Verify content is downloadable
    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${targetIncidentID},IsActiveEntity=true)/attachments(up__ID=${targetIncidentID},ID=${newAtt.ID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse.status).toEqual(200)
    expect(contentResponse.data).toBeTruthy()
  })

  it("Copies an active attachment into a draft incident (active -> draft)", async () => {
    const sourceIncidentID = await newIncident(POST, "processor")
    const targetIncidentID = await newIncident(POST, "processor") // starts as draft
    const sourceCleanWaiter = waitForScanStatus("Clean")

    const sourceAttachmentID = await uploadDraftAttachment(
      utils,
      POST,
      PUT,
      GET,
      sourceIncidentID,
    )
    expect(sourceAttachmentID).toBeTruthy()
    await sourceCleanWaiter

    const AttachmentsSrv = await cds.connect.to("attachments")
    const { ProcessorService } = cds.services
    const Attachments = ProcessorService.entities["Incidents.attachments"]

    // Look up the DraftUUID of the target incident's draft session
    const targetDraft = await SELECT.one
      .from(ProcessorService.entities.Incidents.drafts, {
        ID: targetIncidentID,
      })
      .columns("DraftAdministrativeData_DraftUUID")
    expect(targetDraft?.DraftAdministrativeData_DraftUUID).toBeTruthy()

    const newAtt = await runWithUser(alice, () =>
      AttachmentsSrv.copy(
        Attachments,
        { ID: sourceAttachmentID },
        Attachments.drafts,
        {
          up__ID: targetIncidentID,
          DraftAdministrativeData_DraftUUID:
            targetDraft.DraftAdministrativeData_DraftUUID,
        },
      ),
    )
    expect(newAtt.ID).toBeTruthy()
    expect(newAtt.status).toEqual("Clean")

    // Verify the record exists in the draft table (IsActiveEntity=false)
    const draftAttachments = await GET(
      `odata/v4/processor/Incidents(ID=${targetIncidentID},IsActiveEntity=false)/attachments`,
    )
    expect(draftAttachments.status).toEqual(200)
    expect(draftAttachments.data.value.length).toEqual(1)
    expect(draftAttachments.data.value[0].ID).toEqual(newAtt.ID)

    // After saving the draft, the attachment should appear in the active entity
    await utils.draftModeSave(
      "processor",
      "Incidents",
      targetIncidentID,
      "ProcessorService",
    )
    const activeAttachments = await GET(
      `odata/v4/processor/Incidents(ID=${targetIncidentID},IsActiveEntity=true)/attachments`,
    )
    expect(activeAttachments.status).toEqual(200)
    expect(activeAttachments.data.value.length).toEqual(1)
    expect(activeAttachments.data.value[0].ID).toEqual(newAtt.ID)

    // Content should be downloadable from the active entity
    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${targetIncidentID},IsActiveEntity=true)/attachments(up__ID=${targetIncidentID},ID=${newAtt.ID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse.status).toEqual(200)
    expect(contentResponse.data).toBeTruthy()
  })

  it("Copies a draft attachment into another draft incident (draft -> draft)", async () => {
    const sourceIncidentID = await newIncident(POST, "processor") // draft
    const targetIncidentID = await newIncident(POST, "processor") // draft
    const sourceCleanWaiter = waitForScanStatus("Clean")

    // Upload to source as draft, then save it to active so it gets scanned
    const sourceAttachmentID = await uploadDraftAttachment(
      utils,
      POST,
      PUT,
      GET,
      sourceIncidentID,
    )
    expect(sourceAttachmentID).toBeTruthy()
    await sourceCleanWaiter

    const AttachmentsSrv = await cds.connect.to("attachments")
    const { ProcessorService } = cds.services
    const Attachments = ProcessorService.entities["Incidents.attachments"]

    // Look up DraftUUID for target draft session
    const targetDraft = await SELECT.one
      .from(ProcessorService.entities.Incidents.drafts, {
        ID: targetIncidentID,
      })
      .columns("DraftAdministrativeData_DraftUUID")
    expect(targetDraft?.DraftAdministrativeData_DraftUUID).toBeTruthy()

    // Source is the active Attachments entity (uploaded via draft, now active after save)
    const newAtt = await runWithUser(alice, () =>
      AttachmentsSrv.copy(
        Attachments,
        { ID: sourceAttachmentID },
        Attachments.drafts,
        {
          up__ID: targetIncidentID,
          DraftAdministrativeData_DraftUUID:
            targetDraft.DraftAdministrativeData_DraftUUID,
        },
      ),
    )
    expect(newAtt.ID).toBeTruthy()
    expect(newAtt.status).toEqual("Clean")

    // Verify it is visible in draft context
    const draftAttachments = await GET(
      `odata/v4/processor/Incidents(ID=${targetIncidentID},IsActiveEntity=false)/attachments`,
    )
    expect(draftAttachments.status).toEqual(200)
    expect(draftAttachments.data.value.length).toEqual(1)
    expect(draftAttachments.data.value[0].ID).toEqual(newAtt.ID)
  })

  it("Copy rejects attachment with Infected status", async () => {
    const incidentID = await newIncident(POST, "processor")
    const AttachmentsSrv = await cds.connect.to("attachments")
    const { ProcessorService } = cds.services
    const Attachments = ProcessorService.entities["Incidents.attachments"]

    // Directly insert a fake infected attachment record
    const infectedID = cds.utils.uuid()
    await cds.run(
      INSERT({
        ID: infectedID,
        url: cds.utils.uuid(),
        filename: "infected.pdf",
        mimeType: "application/pdf",
        status: "Infected",
        up__ID: incidentID,
      }).into(Attachments),
    )

    await expect(
      runWithUser(alice, () =>
        AttachmentsSrv.copy(Attachments, { ID: infectedID }, Attachments, {
          up__ID: incidentID,
        }),
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it("Copy rejects non-existent source attachment", async () => {
    const incidentID = await newIncident(POST, "processor")
    const AttachmentsSrv = await cds.connect.to("attachments")
    const { ProcessorService } = cds.services
    const Attachments = ProcessorService.entities["Incidents.attachments"]

    await expect(
      runWithUser(alice, () =>
        AttachmentsSrv.copy(
          Attachments,
          { ID: cds.utils.uuid() },
          Attachments,
          {
            up__ID: incidentID,
          },
        ),
      ),
    ).rejects.toMatchObject({ status: 404 })
  })

  it("Copy strips protected fields from targetKeys", async () => {
    const sourceIncidentID = await newIncident(POST, "processor")
    const targetIncidentID = await newIncident(POST, "processor")
    const sourceCleanWaiter = waitForScanStatus("Clean")

    const sourceAttachmentID = await uploadDraftAttachment(
      utils,
      POST,
      PUT,
      GET,
      sourceIncidentID,
    )
    expect(sourceAttachmentID).toBeTruthy()
    await utils.draftModeSave(
      "processor",
      "Incidents",
      targetIncidentID,
      "ProcessorService",
    )
    await sourceCleanWaiter

    const AttachmentsSrv = await cds.connect.to("attachments")
    const { ProcessorService } = cds.services
    const Attachments = ProcessorService.entities["Incidents.attachments"]

    // Attempt to override protected fields via targetKeys
    const newAtt = await runWithUser(alice, () =>
      AttachmentsSrv.copy(
        Attachments,
        { ID: sourceAttachmentID },
        Attachments,
        {
          up__ID: targetIncidentID,
          status: "Unscanned",
          hash: "tampered-hash",
          filename: "evil.exe",
          mimeType: "application/x-evil",
        },
      ),
    )

    // Protected fields must reflect the source, not the attacker's values
    expect(newAtt.status).toEqual("Clean")
    expect(newAtt.hash).not.toEqual("tampered-hash")
    expect(newAtt.filename).toEqual("sample.pdf")
    expect(newAtt.mimeType).not.toEqual("application/x-evil")
  })
})
