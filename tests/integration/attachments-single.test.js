const cds = require("@sap/cds")
const {
  waitForScanStatus,
  waitUntil,
  waitForMalwareDeletion,
  waitForDeletion,
  runWithUser,
} = require("../utils/testUtils")
const path = require("path")

const app = path.resolve(__dirname, "../incidents-app")
const { axios, GET, POST, DELETE, PATCH, PUT } = cds.test(app)
axios.defaults.auth = { username: "alice" }
const alice = new cds.User({ id: "alice", roles: { admin: 1, support: 1 } })
const { createReadStream, readFileSync } = cds.utils.fs
const { join } = cds.utils.path

describe("Tests for single attachment entity", () => {
  const isNotLocal = cds.env.requires?.attachments?.kind === "db" ? it.skip : it
  let log = cds.test.log()

  it("Should correctly detect inline attachment fields on SingleAttachment", async () => {
    const Catalog = await cds.connect.to("ProcessorService")
    const SingleAttachment = Catalog.entities.SingleAttachment
    const Incidents_attachments = Catalog.entities["Incidents.attachments"]

    // SingleAttachment has `myAttachment : Attachment` — an inline single field
    expect(SingleAttachment._attachments.inlineAttachmentPrefixes).toEqual([
      "myAttachment",
    ])
    expect(SingleAttachment._attachments.hasInlineAttachments).toBe(true)

    // It is NOT itself a media entity, and has no composition to one
    expect(SingleAttachment._attachments.isAttachmentsEntity).toBe(false)
    expect(SingleAttachment._attachments.hasAttachmentsComposition).toBe(false)

    // A composition-based attachment entity must NOT be detected as inline
    expect(Incidents_attachments._attachments.inlineAttachmentPrefixes).toEqual(
      [],
    )
    expect(Incidents_attachments._attachments.hasInlineAttachments).toBe(false)
    expect(Incidents_attachments._attachments.isAttachmentsEntity).toBe(true)
  })

  it("Should create a SingleAttachment with an attachment", async () => {
    const scanCleanWaiter = waitForScanStatus("Clean")
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "My Single Attachment Test",
        myAttachment_filename: "sample.pdf",
      },
    )
    expect(singleAttachment.ID).toBeDefined()
    expect(singleAttachment.name).toBe("My Single Attachment Test")

    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)

    const putContentRes = await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
        },
      },
    )
    expect(putContentRes.status).toEqual(204)

    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    await scanCleanWaiter

    const getRes = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
    )
    expect(getRes.status).toEqual(200)
    expect(getRes.data).toEqual(fileContent.toString())
  })

  it("Should delete a SingleAttachment and its attachment", async () => {
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "Entity to be deleted",
        myAttachment_filename: "sample.pdf",
      },
    )

    expect(singleAttachment.ID).toBeDefined()

    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )

    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    const updatedRecord = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)`,
    )

    expect(updatedRecord.data.myAttachment_url).toBeDefined()

    const deleteRes = await DELETE(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)`,
    )
    expect(deleteRes.status).toEqual(204)

    await expect(
      GET(
        `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)`,
      ),
    ).rejects.toThrow("404")

    const db = await cds.connect.to("db")
    const record = await db.run(
      SELECT.one
        .from("sap.capire.incidents.SingleAttachment")
        .where({ ID: singleAttachment.ID }),
    )
    expect(record).toBeUndefined()
  })

  it("Should create a SingleAttachment with content in a single POST", async () => {
    const fileContent = "inline attachment content via single POST!"
    const fileContentB64 = Buffer.from(fileContent).toString("base64")

    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "My Single Attachment (deep create)",
        myAttachment_filename: "sample.txt",
        myAttachment_content: fileContentB64,
      },
    )

    expect(singleAttachment.ID).toBeDefined()
    expect(singleAttachment.myAttachment_url).toBeDefined()
    expect(singleAttachment.myAttachment_content).toBeUndefined()

    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    const db = await cds.connect.to("db")
    await db.run(
      UPDATE("sap.capire.incidents.SingleAttachment")
        .set({
          myAttachment_status: "Clean",
          myAttachment_lastScan: new Date().toISOString(),
        })
        .where({ ID: singleAttachment.ID }),
    )

    const getContentRes = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
    )
    expect(getContentRes.status).toEqual(200)
    expect(getContentRes.data).toEqual(fileContent)
  })

  it("Should fail to upload content that exceeds the size limit", async () => {
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "Attachment too large",
        myAttachment_filename: "large.txt",
      },
    )

    let expectedError
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      createReadStream(join(__dirname, "content/sample.pdf")),
      {
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": 6 * 1024 * 1024,
        },
      },
    ).catch((e) => {
      expectedError = e
    })

    expect(expectedError.response.status).toEqual(413)
    expect(expectedError.response.data.error.message).toMatch(
      'The size of "large.txt" exceeds the maximum allowed limit of 5MB',
    )
  })

  it("Should fail to create a SingleAttachment with oversized content in a single POST", async () => {
    const svc = await cds.connect.to("ProcessorService")
    const el = svc.entities.SingleAttachment.elements.myAttachment_content
    const origMax = el["@Validation.Maximum"]
    el["@Validation.Maximum"] = "1KB"

    const content = Buffer.from("a".repeat(2 * 1024)).toString("base64") // 2KB > 1KB

    let expectedError
    await POST("/odata/v4/processor/SingleAttachment", {
      name: "Oversized inline attachment",
      myAttachment_filename: "large.txt",
      myAttachment_content: content,
    }).catch((e) => {
      expectedError = e
    })

    el["@Validation.Maximum"] = origMax

    expect(expectedError?.response?.status).toEqual(413)
    expect(expectedError?.response?.data?.error?.message).toMatch(
      'The size of "large.txt" exceeds the maximum allowed limit of 1KB',
    )
  })

  it("Should trigger a re-scan when getting content with an expired scan date", async () => {
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "My Attachment for Rescan",
        myAttachment_filename: "rescan.txt",
      },
    )

    const fileContent = "this content needs to be rescanned"
    const putContentRes = await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "text/plain" } },
    )
    expect(putContentRes.status).toEqual(204)

    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)`,
    )

    // Manually update the scan status to simulate an old scan
    const db = await cds.connect.to("db")
    await db.run(
      UPDATE("sap.capire.incidents.SingleAttachment")
        .set({
          myAttachment_status: "Clean",
          myAttachment_lastScan: new Date(2000, 1, 1).toISOString(), // A very old date
        })
        .where({ ID: singleAttachment.ID }),
    )

    const getRes = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
    )

    expect(getRes.status).toEqual(202)
    expect(getRes.data?.error?.message).toBe(
      "The previous scan was more than 3 days ago. Please try to download again in a moment, after the attachment is rescanned.",
    )
  })

  it("Should not allow end user to set or change myAttachment_url from api", async () => {
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "URL protection test",
        myAttachment_filename: "sample.pdf",
        myAttachment_url: "malicious-url",
      },
    )
    expect(singleAttachment.ID).toBeDefined()

    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )

    const { data: draft } = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)`,
    )
    expect(draft.myAttachment_url).toBeTruthy()
    expect(draft.myAttachment_url).not.toBe("malicious-url")

    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    const { data: active } = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)`,
    )
    const originalUrl = active.myAttachment_url
    expect(originalUrl).toBeTruthy()
    expect(originalUrl).not.toBe("malicious-url")

    // Try to PATCH the url on the active entity
    await PATCH(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)`,
      { myAttachment_url: "patched-malicious-url" },
    )

    const { data: afterPatch } = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)`,
    )
    expect(afterPatch.myAttachment_url).toBe(originalUrl)
    expect(afterPatch.myAttachment_url).not.toBe("patched-malicious-url")
  })

  it("Should return 404 when getting content with no file uploaded", async () => {
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "No content entity",
        myAttachment_filename: "missing.pdf",
      },
    )

    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    let expectedError
    await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
    ).catch((e) => {
      expectedError = e
    })

    expect(expectedError?.response?.status || expectedError?.status).toEqual(
      404,
    )
  })

  it("Should discard draft and delete blob from object store", async () => {
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "Discard test",
        myAttachment_filename: "sample.pdf",
      },
    )

    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )

    // Read the draft entity to get the url before discarding
    const { data: draft } = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)`,
    )
    const attachmentUrl = draft.myAttachment_url
    expect(attachmentUrl).toBeTruthy()

    const deletionWaiter = waitForDeletion(attachmentUrl)

    const discardRes = await DELETE(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)`,
    )
    expect(discardRes.status).toEqual(204)

    await deletionWaiter
  })

  // prettier-ignore
  isNotLocal("Should emit DeleteAttachment when active SingleAttachment entity is deleted without open draft", async () => {
    const scanCleanWaiter = waitForScanStatus("Clean")

    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      { name: "Active delete test" },
    )
    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
    )

    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )
    await scanCleanWaiter

    const { data: active } = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)`,
    )
    expect(active.myAttachment_url).toBeTruthy()

    const deletionWaiter = waitForDeletion(active.myAttachment_url)

    await DELETE(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)`,
    )

    expect(await deletionWaiter).toBe(true)
  })

  it("Should serve new content after re-edit and re-upload", async () => {
    const scanCleanWaiter1 = waitForScanStatus("Clean")

    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "Re-edit test",
        myAttachment_filename: "v1.txt",
      },
    )

    const v1Content = "version 1 content!"
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      v1Content,
      { headers: { "Content-Type": "text/plain" } },
    )

    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )
    await scanCleanWaiter1

    // Verify v1 content is readable
    const getV1 = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
    )
    expect(getV1.status).toEqual(200)
    expect(getV1.data).toEqual(v1Content)

    // Re-edit: create a new draft from the active entity
    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/draftEdit`,
      {},
    )

    const scanCleanWaiter2 = waitForScanStatus("Clean")
    const v2Content = "version 2 content - updated"
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      v2Content,
      { headers: { "Content-Type": "text/plain" } },
    )

    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )
    await scanCleanWaiter2

    // Verify v2 content is now returned
    const getV2 = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
    )
    expect(getV2.status).toEqual(200)
    expect(getV2.data).toEqual(v2Content)
  })

  it("Should populate myAttachment_url on the active entity after draft activation", async () => {
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "URL population test",
        myAttachment_filename: "sample.pdf",
      },
    )

    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )

    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    const { data: active } = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)`,
    )
    expect(active.myAttachment_url).toBeTruthy()
    expect(typeof active.myAttachment_url).toBe("string")
    expect(active.myAttachment_url.length).toBeGreaterThan(0)
  })

  it("Malware scanning does not happen for SingleAttachment when scan is disabled", async () => {
    cds.env.requires.attachments.scan = false

    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "No-scan test",
        myAttachment_filename: "sample.pdf",
      },
    )

    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )

    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    // Content should be immediately readable without waiting
    const getRes = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
    )
    expect(getRes.status).toEqual(200)
    expect(getRes.data).toBeTruthy()

    expect(log.output).not.toContain("Initiating malware scan request")

    cds.env.requires.attachments.scan = true
  })

  it("Should successfully serve content after a re-scan is triggered for an expired inline attachment", async () => {
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "Rescan completion test",
        myAttachment_filename: "rescan.txt",
      },
    )

    const fileContent = "content that will be rescanned"
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "text/plain" } },
    )

    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    const db = await cds.connect.to("db")
    await waitUntil(async () => {
      const row = await db.run(
        SELECT.one
          .from("sap.capire.incidents.SingleAttachment")
          .where({ ID: singleAttachment.ID }),
      )
      return row?.myAttachment_status === "Clean"
    })

    await db.run(
      UPDATE("sap.capire.incidents.SingleAttachment")
        .set({
          myAttachment_status: "Clean",
          myAttachment_lastScan: new Date(2000, 1, 1).toISOString(),
        })
        .where({ ID: singleAttachment.ID }),
    )

    const rescanStart = new Date()
    const rescanRes = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
    ).catch((e) => e.response)
    expect(rescanRes.status).toEqual(202)

    await waitUntil(async () => {
      const row = await db.run(
        SELECT.one
          .from("sap.capire.incidents.SingleAttachment")
          .where({ ID: singleAttachment.ID }),
      )
      return (
        row?.myAttachment_status === "Clean" &&
        new Date(row.myAttachment_lastScan) > rescanStart
      )
    })

    const getRes = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
    )
    expect(getRes.status).toEqual(200)
    expect(getRes.data).toEqual(fileContent)
  })

  it("Should not delete blob when discarding a re-edit with no new upload", async () => {
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "Re-edit discard no-upload test",
        myAttachment_filename: "keep-me.pdf",
      },
    )

    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )
    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    const { data: active } = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)`,
    )
    const originalUrl = active.myAttachment_url
    expect(originalUrl).toBeTruthy()

    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/draftEdit`,
      {},
    )

    const discardRes = await DELETE(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)`,
    )
    expect(discardRes.status).toEqual(204)

    const db = await cds.connect.to("db")
    const record = await db.run(
      SELECT.one
        .from("sap.capire.incidents.SingleAttachment")
        .where({ ID: singleAttachment.ID }),
    )
    expect(record.myAttachment_url).toEqual(originalUrl)

    await db.run(
      UPDATE("sap.capire.incidents.SingleAttachment")
        .set({
          myAttachment_status: "Clean",
          myAttachment_lastScan: new Date().toISOString(),
        })
        .where({ ID: singleAttachment.ID }),
    )
    const getRes = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
    )
    expect(getRes.status).toEqual(200)
  })

  it("Should return 403 when content is in Scanning status", async () => {
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "Scanning status test",
        myAttachment_filename: "scanning.txt",
      },
    )

    const fileContent = "content under scan"
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "text/plain" } },
    )
    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    // Force status to Scanning
    const db = await cds.connect.to("db")
    await db.run(
      UPDATE("sap.capire.incidents.SingleAttachment")
        .set({
          myAttachment_status: "Scanning",
          myAttachment_url: "some-url",
          myAttachment_lastScan: new Date().toISOString(),
        })
        .where({ ID: singleAttachment.ID }),
    )

    let expectedError
    await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
    ).catch((e) => {
      expectedError = e.response ?? e
    })

    expect(expectedError?.status ?? expectedError?.response?.status).toEqual(
      403,
    )
  })

  it("Should return 403 when content has Infected status", async () => {
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "Infected status test",
        myAttachment_filename: "infected.txt",
      },
    )

    const fileContent = "definitely not malware"
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "text/plain" } },
    )
    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    // Force status to Infected with a url so validateAttachment doesn't 404
    const db = await cds.connect.to("db")
    await db.run(
      UPDATE("sap.capire.incidents.SingleAttachment")
        .set({
          myAttachment_status: "Infected",
          myAttachment_url: "some-url",
          myAttachment_lastScan: new Date().toISOString(),
        })
        .where({ ID: singleAttachment.ID }),
    )

    let expectedError
    await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/myAttachment_content`,
    ).catch((e) => {
      expectedError = e.response ?? e
    })

    expect(expectedError?.status ?? expectedError?.response?.status).toEqual(
      403,
    )
  })

  it("Should serve content from draft before activation", async () => {
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "Draft content readable test",
        myAttachment_filename: "draft-content.txt",
      },
    )

    const fileContent = "content readable in draft mode"
    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "text/plain" } },
    )

    const getRes = await GET(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
    )
    expect(getRes.status).toEqual(200)
    expect(getRes.data).toEqual(fileContent)
  })

  it("Should clear inline attachment fields when DeleteInfectedAttachment is triggered with the correct hash", async () => {
    const scanCleanWaiter = waitForScanStatus("Clean")

    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "DeleteInfectedAttachment bug test",
        myAttachment_filename: "infected.txt",
      },
    )

    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      "some file content",
      { headers: { "Content-Type": "text/plain" } },
    )
    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    await scanCleanWaiter

    const db = await cds.connect.to("db")
    const before = await db.run(
      SELECT.one
        .from("sap.capire.incidents.SingleAttachment")
        .where({ ID: singleAttachment.ID }),
    )
    expect(before.myAttachment_url).toBeTruthy()
    expect(before.myAttachment_hash).toBeTruthy()

    const malwareDeletionWaiter = waitForMalwareDeletion(singleAttachment.ID)

    // Emit DeleteInfectedAttachment exactly as the scanner would
    const AttachmentsSrv = await cds.connect.to("attachments")
    await AttachmentsSrv.emit("DeleteInfectedAttachment", {
      target: "sap.capire.incidents.SingleAttachment",
      keys: { ID: singleAttachment.ID },
      hash: before.myAttachment_hash,
      prefix: "myAttachment",
    })

    await malwareDeletionWaiter

    let after
    for (let i = 0; i < 20; i++) {
      after = await db.run(
        SELECT.one
          .from("sap.capire.incidents.SingleAttachment")
          .where({ ID: singleAttachment.ID }),
      )
      if (after.myAttachment_url === null) break
      await new Promise((r) => setTimeout(r, 500))
    }

    expect(after.myAttachment_url).toBeNull()
    expect(after.myAttachment_hash).toBeNull()
  })

  it("Should clear inline attachment fields after deleting the file and saving", async () => {
    const scanCleanWaiter = waitForScanStatus("Clean")
    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      { name: "Delete-file test", myAttachment_filename: "delete-me.txt" },
    )

    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      "content to be deleted",
      { headers: { "Content-Type": "text/plain" } },
    )
    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )
    await scanCleanWaiter

    // Confirm attachment fields are set on the active entity
    const db = await cds.connect.to("db")
    const before = await db.run(
      SELECT.one
        .from("sap.capire.incidents.SingleAttachment")
        .where({ ID: singleAttachment.ID }),
    )
    expect(before.myAttachment_url).toBeTruthy()
    expect(before.myAttachment_filename).toBe("delete-me.txt")
    expect(before.myAttachment_status).toBe("Clean")

    // Re-edit
    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=true)/draftEdit`,
      {},
    )

    await PATCH(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)`,
      { myAttachment_content: null },
    )

    // Save
    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )

    const after = await db.run(
      SELECT.one
        .from("sap.capire.incidents.SingleAttachment")
        .where({ ID: singleAttachment.ID }),
    )
    expect(after.myAttachment_filename).toBeNull()
    expect(after.myAttachment_status).toBe("Unscanned")
    expect(after.myAttachment_url).toBeNull()
  })

  // prettier-ignore
  isNotLocal("Programmatic SELECT with columns('myAttachment_content') returns bytes from object store", async () => {
    const scanCleanWaiter = waitForScanStatus("Clean")

    const { data: singleAttachment } = await POST(
      "/odata/v4/processor/SingleAttachment",
      {
        name: "Programmatic content fetch test",
        myAttachment_filename: "sample.pdf",
      },
    )

    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)

    await PUT(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
      fileContent,
      { headers: { "Content-Type": "application/pdf" } },
    )
    await POST(
      `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/draftActivate`,
      {},
    )
    await scanCleanWaiter

    const srv = await cds.connect.to("ProcessorService")
    const SingleAttachment = srv.entities.SingleAttachment

    const result = await runWithUser(alice, () =>
      SELECT.one
        .from(SingleAttachment)
        .columns("myAttachment_content")
        .where({ ID: singleAttachment.ID }),
    )

    expect(result).toBeTruthy()
    const chunks = []
    await new Promise((resolve, reject) => {
      result.myAttachment_content.on("data", (chunk) => chunks.push(chunk))
      result.myAttachment_content.on("end", resolve)
      result.myAttachment_content.on("error", reject)
    })
    expect(Buffer.concat(chunks).length).toBeGreaterThan(0)
  })

  it("Should accept upload when file type matches @Core.AcceptableMediaTypes on inline attachment", async () => {
    const svc = await cds.connect.to("ProcessorService")
    const el = svc.entities.SingleAttachment.elements.myAttachment_content
    const origTypes = el["@Core.AcceptableMediaTypes"]
    el["@Core.AcceptableMediaTypes"] = ["application/pdf"]

    try {
      const { data: singleAttachment } = await POST(
        "/odata/v4/processor/SingleAttachment",
        { name: "Mime type allowed test", myAttachment_filename: "sample.pdf" },
      )

      const filepath = join(__dirname, "content/sample.pdf")
      const fileContent = readFileSync(filepath)

      const putRes = await PUT(
        `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
        fileContent,
        { headers: { "Content-Type": "application/pdf" } },
      )
      expect(putRes.status).toEqual(204)
    } finally {
      el["@Core.AcceptableMediaTypes"] = origTypes
    }
  })

  it("Should reject upload when file type does not match @Core.AcceptableMediaTypes on inline attachment", async () => {
    const svc = await cds.connect.to("ProcessorService")
    const el = svc.entities.SingleAttachment.elements.myAttachment_content
    const origTypes = el["@Core.AcceptableMediaTypes"]
    el["@Core.AcceptableMediaTypes"] = ["image/jpeg"]

    try {
      const { data: singleAttachment } = await POST(
        "/odata/v4/processor/SingleAttachment",
        {
          name: "Mime type rejected test",
          myAttachment_filename: "sample.pdf",
        },
      )

      const filepath = join(__dirname, "content/sample.pdf")
      const fileContent = readFileSync(filepath)

      let expectedError
      await PUT(
        `/odata/v4/processor/SingleAttachment(ID=${singleAttachment.ID},IsActiveEntity=false)/myAttachment_content`,
        fileContent,
        { headers: { "Content-Type": "application/pdf" } },
      ).catch((e) => {
        expectedError = e
      })
      expect(expectedError?.response?.status).toEqual(400)
      expect(expectedError?.response?.data?.error?.message).toMatch(
        "The attachment file type 'application/pdf' is not allowed.",
      )
    } finally {
      el["@Core.AcceptableMediaTypes"] = origTypes
    }
  })
})
