const cds = require("@sap/cds")
const { RequestSend } = require("../utils/api")
const {
  waitForScanStatus,
  newIncident,
  waitForMalwareDeletion,
  waitForDeletion,
  runWithUser,
  uploadDraftAttachment,
} = require("../utils/testUtils")
const path = require("path")
const { Readable } = require("stream")

const app = path.resolve(__dirname, "../incidents-app")
const { axios, GET, POST, DELETE, PATCH, PUT } = cds.test(app)
axios.defaults.auth = { username: "alice" }
const alice = new cds.User({ id: "alice", roles: { admin: 1, support: 1 } })
const { createReadStream, readFileSync } = cds.utils.fs
const { join, basename } = cds.utils.path

let utils = null

describe("Tests for uploading/deleting attachments through API calls", () => {
  let log = cds.test.log()
  const isNotLocal = cds.env.requires?.attachments?.kind === "db" ? it.skip : it
  beforeAll(async () => {
    utils = new RequestSend(POST)
  })

  //Draft mode uploading attachment
  it("Uploading attachment in draft mode with scanning enabled", async () => {
    const incidentID = await newIncident(POST, "processor")
    let sampleDocID
    const scanStartWaiter = waitForScanStatus("Scanning")
    const scanCleanWaiter = waitForScanStatus("Clean")

    const db = await cds.connect.to("db")
    const ScanStates = []
    db.after("*", (res, req) => {
      if (
        req.event === "UPDATE" &&
        req.query?.UPDATE?.data?.status &&
        req.target.name.includes(".attachments")
      ) {
        ScanStates.push(req.query.UPDATE.data.status)
      }
    })
    // Upload attachment using helper function
    sampleDocID = await uploadDraftAttachment(utils, POST, PUT, GET, incidentID)
    expect(sampleDocID).toBeTruthy()

    //read attachments list for Incident
    const attachmentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )
    //the data should have only one attachment
    expect(attachmentResponse.status).toEqual(200)
    expect(attachmentResponse.data.value.length).toEqual(1)
    //to make sure content is not read
    expect(attachmentResponse.data.value[0].content).toBeFalsy()
    sampleDocID = attachmentResponse.data.value[0].ID

    await scanStartWaiter

    // Check Scanning status
    const scanResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )
    expect(scanResponse.status).toEqual(200)
    expect(scanResponse.data.value.length).toEqual(1)
    expect(ScanStates.some((s) => s === "Scanning")).toBeTruthy()

    await scanCleanWaiter

    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse.status).toEqual(200)
    expect(contentResponse.data).toBeTruthy()

    //Check clean status
    const resultResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )
    expect(resultResponse.status).toEqual(200)
    expect(ScanStates.some((s) => s === "Clean")).toBeTruthy()
  })

  it("Uploading attachment that exceeds 5MB limit should fail", async () => {
    const incidentID = await newIncident(POST, "processor")

    const attachmentResult = await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/maximumSizeAttachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    )

    let expectedError
    await PUT(
      `/odata/v4/processor/Incidents_maximumSizeAttachments(up__ID=${incidentID},ID=${attachmentResult.data.ID},IsActiveEntity=false)/content`,
      createReadStream(join(__dirname, "content/test.pdf")),
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": 6 * 1024 * 1024, // 6 MB
        },
      },
    ).catch((e) => {
      expectedError = e
    })

    expect(expectedError.status).toEqual(413)
    expect(expectedError.response.data.error.message).toMatch(
      'The size of "sample.pdf" exceeds the maximum allowed limit of 5MB',
    )
  })

  it("Uploading attachment that exceeds 5MB limit should fail with nested attachment creation and content upload", async () => {
    const incidentID = await newIncident(POST, "processor")

    const fakeFileBuffer = Buffer.alloc(6 * 1024 * 1024, "adalovelace") // 6 MB

    let expectedError
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/maximumSizeAttachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        content: fakeFileBuffer,
        createdBy: "alice",
      },
    ).catch((e) => {
      expectedError = e
    })

    expect(expectedError.status).toEqual(413)
    expect(expectedError.response.data.error.message).toMatch(
      "request entity too large",
    )
  })

  isNotLocal(
    "Uploading attachment that exceeds 5MB limit should fail when Content-Length header is not provided",
    async () => {
      const incidentID = await newIncident(POST, "processor")

      const attachmentResult = await POST(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/maximumSizeAttachments`,
        {
          up__ID: incidentID,
          filename: "large-stream.pdf",
          mimeType: "application/pdf",
          createdAt: new Date(
            Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
          ),
          createdBy: "alice",
        },
      )

      // Create a readable stream that generates 6MB of data
      const chunkSize = 64 * 1024 // 64KB chunks
      const totalSize = 6 * 1024 * 1024 // 6MB total
      let bytesGenerated = 0
      const largeStream = new Readable({
        read() {
          if (bytesGenerated >= totalSize) {
            this.push(null)
            return
          }
          const remainingBytes = totalSize - bytesGenerated
          const size = Math.min(chunkSize, remainingBytes)
          const chunk = Buffer.alloc(size, "x")
          bytesGenerated += size
          this.push(chunk)
        },
      })

      let expectedError
      await axios
        .put(
          `/odata/v4/processor/Incidents_maximumSizeAttachments(up__ID=${incidentID},ID=${attachmentResult.data.ID},IsActiveEntity=false)/content`,
          largeStream,
          {
            headers: {
              "Content-Type": "application/pdf",
              // No Content-Length header - server must track size during streaming
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
          },
        )
        .catch((e) => {
          expectedError = e
        })

      expect(expectedError).toBeDefined()
      expect(expectedError.response?.status || expectedError.status).toEqual(
        413,
      )
      expect(expectedError.response.data.error.message).toMatch(
        'The size of "large-stream.pdf" exceeds the maximum allowed limit of 5MB',
      )
    },
    5 * 60 * 1000, // 5 minute timeout for cloud storage abort operations
  )

  // Draft mode uploading attachment
  it("Uploading attachment in draft mode with scanning enabled and re-scanning on expiry", async () => {
    const incidentID = await newIncident(POST, "processor")
    let sampleDocID
    const scanStartWaiter = waitForScanStatus("Scanning")
    const scanCleanWaiter = waitForScanStatus("Clean")

    const db = await cds.connect.to("db")
    const ScanStates = []
    db.after("*", (res, req) => {
      if (
        req.event === "UPDATE" &&
        req.query?.UPDATE?.data?.status &&
        req.target.name.includes(".attachments")
      ) {
        ScanStates.push(req.query.UPDATE.data.status)
      }
    })
    // Upload attachment using helper function
    sampleDocID = await uploadDraftAttachment(utils, POST, PUT, GET, incidentID)
    expect(sampleDocID).toBeTruthy()

    //read attachments list for Incident
    const attachmentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )
    //the data should have only one attachment
    expect(attachmentResponse.status).toEqual(200)
    expect(attachmentResponse.data.value.length).toEqual(1)
    //to make sure content is not read
    expect(attachmentResponse.data.value[0].content).toBeFalsy()
    sampleDocID = attachmentResponse.data.value[0].ID

    await scanStartWaiter

    // Check Scanning status
    const scanResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )
    expect(scanResponse.status).toEqual(200)
    expect(scanResponse.data.value.length).toEqual(1)
    expect(ScanStates.some((s) => s === "Scanning")).toBeTruthy()

    await scanCleanWaiter

    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse.status).toEqual(200)
    expect(contentResponse.data).toBeTruthy()
    const Incidents_attachments = cds.entities("sap.capire.incidents")[
      "Incidents.attachments"
    ]
    await UPDATE.entity(Incidents_attachments)
      .where({ ID: sampleDocID })
      .set({ lastScan: "2020-01-01T00:00:00" })

    await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    ).catch((e) => {
      expect(e.status).toEqual(202)
      expect(e.response.data.error.message).toContain(
        "The previous scan was more than 3 days ago. Please try to download again in a moment, after the attachment is rescanned.",
      )
    })
  })

  it("Scan status is translated", async () => {
    const incidentID = await newIncident(POST, "processor")
    //trigger to upload attachment
    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "test.pdf",
        mimeType: "application/pdf",
        content: createReadStream(join(__dirname, "content/test.pdf")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    )
    await utils.draftModeSave(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const scanStatesEN = await cds.run(
      SELECT.from("sap.attachments.ScanStates"),
    )
    const scanStatesDE = await cds.run(
      SELECT.localized
        .from("sap.attachments.ScanStates")
        .columns("code", `texts[locale='de'].name as name`),
    )

    // Check Scanning status
    const response = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments?$expand=statusNav($select=name,code)`,
    )
    expect(response.status).toEqual(200)
    expect(response.data.value.length).toEqual(1)
    expect(response.data.value[0].statusNav.name).toEqual(
      scanStatesEN.find((state) => state.code === response.data.value[0].status)
        .name,
    )

    const responseDE = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments?$expand=statusNav($select=name,code)&sap-locale=de`,
    )
    expect(responseDE.status).toEqual(200)
    expect(responseDE.data.value.length).toEqual(1)
    expect(responseDE.data.value[0].statusNav.name).toEqual(
      scanStatesDE.find(
        (state) => state.code === responseDE.data.value[0].status,
      ).name,
    )
  })

  it("Deleting the attachment", async () => {
    const incidentID = await newIncident(POST, "processor")
    let sampleDocID

    const scanCleanWaiter = waitForScanStatus("Clean")

    // First upload an attachment to delete
    sampleDocID = await uploadDraftAttachment(utils, POST, PUT, GET, incidentID)

    // Check the content of the uploaded attachment in main table
    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse.status).toEqual(200)

    const attachmentData = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)`,
    )

    // Trigger to delete attachment
    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const attachmentsSrv = await cds.connect.to("attachments")
    const attachmentIDs = []
    attachmentsSrv.before("DeleteAttachment", (req) => {
      attachmentIDs.push(req.data?.url)
    })

    const deletionWaiter = waitForDeletion(attachmentData.data.url)

    //delete attachment
    await DELETE(
      `odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=false)`,
    )

    // Content should still be accessible on the active entity while deletion is only staged in draft
    const contentWhileInDraft = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    expect(contentWhileInDraft.status).toEqual(200)

    await utils.draftModeSave(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    // Wait for the outbox to dispatch the DeleteAttachment event
    await deletionWaiter

    expect(attachmentIDs[0]).toEqual(attachmentData.data.url)
    expect(attachmentIDs.length).toEqual(1)

    // Read attachments list for Incident
    const response = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )
    // Data should have no attachments
    expect(response.status).toEqual(200)
    expect(response.data.value.length).toEqual(0)

    await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    ).catch((e) => {
      expect(e.status).toEqual(404)
      expect(e.response.data.error.message).toMatch(/Not Found/)
    })
  })

  it("Deleting a non existing root does not crash the application", async () => {
    const incidentID = await newIncident(POST, "processor")
    await utils.draftModeSave(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )
    const response = await DELETE(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)`,
    )
    expect(response.status).toEqual(204)

    await DELETE(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)`,
    ).catch((e) => {
      expect(e.status).toEqual(404)
      expect(e.response.data.error.message).toMatch(/Not Found/)
    })
  })

  it("Discarding a saved draft should not delete previous attachment content", async () => {
    const incidentID = await newIncident(POST, "processor")
    const scanCleanWaiter = waitForScanStatus("Clean")

    const sampleDocID = await uploadDraftAttachment(
      utils,
      POST,
      PUT,
      GET,
      incidentID,
    )
    expect(sampleDocID).toBeTruthy()
    await scanCleanWaiter

    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const secondAttachRes = await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "draft-only.pdf",
        mimeType: "application/pdf",
        createdBy: "alice",
      },
    )
    expect(secondAttachRes.data.ID).toBeTruthy()
    const draftFileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${secondAttachRes.data.ID},IsActiveEntity=false)/content`,
      draftFileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": draftFileContent.byteLength,
        },
      },
    )

    await DELETE(
      `/odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${secondAttachRes.data.ID},IsActiveEntity=false)`,
    )

    // Save the draft (leave edit mode)
    await utils.draftModeSave(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    // First attachment must still exist after the draft save
    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse.status).toEqual(200)
    expect(contentResponse.data).toBeTruthy()
  })

  it("Cancel draft where parent has composed key", async () => {
    const gjahr = Math.round(Math.random() * 1000)
    const sampleID = `ABC ${Math.round(Math.random() * 1000)}`
    await POST(`odata/v4/processor/SampleRootWithComposedEntity`, {
      sampleID: sampleID,
      gjahr: gjahr,
    })

    const doc = await POST(
      `odata/v4/processor/SampleRootWithComposedEntity(sampleID='${sampleID}',gjahr=${gjahr},IsActiveEntity=false)/attachments`,
      {
        up__sampleID: sampleID,
        up__gjahr: gjahr,
        filename: "myfancyfile.pdf",
        content: createReadStream(
          join(__dirname, "..", "integration", "content/sample.pdf"),
        ),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    )
    expect(doc.data.ID).toBeTruthy()

    const deleteRes = await DELETE(
      `odata/v4/processor/SampleRootWithComposedEntity(sampleID='${sampleID}',gjahr=${gjahr},IsActiveEntity=false)`,
    )
    expect(deleteRes.status).toEqual(204)
  })

  it("On handler for attachments can be overwritten", async () => {
    const gjahr = Math.round(Math.random() * 1000)
    const sampleID = `ABC ${Math.round(Math.random() * 1000)}`
    await POST(`odata/v4/processor/SampleRootWithComposedEntity`, {
      sampleID,
      gjahr,
    })

    const doc = await POST(
      `odata/v4/processor/SampleRootWithComposedEntity(sampleID='${sampleID}',gjahr=${gjahr},IsActiveEntity=false)/attachments`,
      {
        up__sampleID: sampleID,
        up__gjahr: gjahr,
        filename: "myfancyfile.pdf",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    )
    expect(doc.data.ID).toBeTruthy()

    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/processor/SampleRootWithComposedEntity_attachments(up__sampleID='${sampleID}',up__gjahr=${gjahr},ID=${doc.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      },
    )
    expect(log.output.length).toBeGreaterThan(0)
    expect(log.output).toContain("overwrite-put-handler")

    const file = await GET(
      `/odata/v4/processor/SampleRootWithComposedEntity_attachments(up__sampleID='${sampleID}',up__gjahr=${gjahr},ID=${doc.data.ID},IsActiveEntity=false)/content`,
    )

    expect(file.status).toEqual(200)
  })

  it("Inserting attachments via srv.run works", async () => {
    const incidentID = await newIncident(POST, "processor")
    const Catalog = await cds.connect.to("ProcessorService")

    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )
    const incident = await SELECT.one
      .from(Catalog.entities.Incidents.drafts)
      .where({ ID: incidentID })

    const scanCleanWaiter = waitForScanStatus("Clean")

    const fileContent = createReadStream(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    const attachmentsID = cds.utils.uuid()
    const user = new cds.User({ id: "alice", roles: { support: 1 } })
    const ctx = cds.EventContext.for({
      id: cds.utils.uuid(),
      http: { req: null, res: null },
    })
    ctx.user = user
    await cds._with(ctx, () =>
      Catalog.run(
        INSERT.into(Catalog.entities["Incidents.attachments"].drafts).entries({
          ID: attachmentsID,
          up__ID: incidentID,
          IsActiveEntity: false,
          DraftAdministrativeData_DraftUUID:
            incident.DraftAdministrativeData_DraftUUID,
          filename: "sample.pdf",
          content: fileContent,
          mimeType: "application/pdf",
          createdAt: new Date(
            Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
          ),
          createdBy: "alice",
        }),
      ),
    )

    const response = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
    )
    //the data should have no attachments
    expect(response.status).toEqual(200)
    expect(response.data.value.length).toEqual(1)

    await scanCleanWaiter

    //content should not be there
    const responseContent = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments(up__ID=${incidentID},ID=${attachmentsID},IsActiveEntity=true)/content`,
    )
    expect(responseContent.status).toEqual(200)
  })

  it("Uploading attachment that exceeds annotation size limit via direct POST should fail", async () => {
    const incidentID = await newIncident(POST, "processor")

    // Temporarily lower the max to 1KB so we stay well under Express body limit
    const svc = await cds.connect.to("ProcessorService")
    const el = svc.entities["Incidents.maximumSizeAttachments"].elements.content
    const origMax = el["@Validation.Maximum"]
    el["@Validation.Maximum"] = "1KB"

    const content = Buffer.from("a".repeat(2 * 1024)).toString("base64") // 2KB > 1KB limit

    let expectedError
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/maximumSizeAttachments`,
      {
        up__ID: incidentID,
        filename: "toobig.txt",
        mimeType: "text/plain",
        content,
      },
    ).catch((e) => {
      expectedError = e
    })

    el["@Validation.Maximum"] = origMax

    expect(expectedError?.response?.status).toEqual(413)
    expect(expectedError?.response?.data?.error?.message).toMatch(
      'The size of "toobig.txt" exceeds the maximum allowed limit of 1KB',
    )
  })

  it("Calling a CAP action via srv.send does not crash handlers", async () => {
    const srv = await cds.connect.to("ProcessorService")

    // srv.send dispatches a request with no CQN query — the pattern
    // CAP docs show for calling custom actions programmatically.
    const result = await runWithUser(alice, () =>
      srv.send({
        method: "POST",
        path: "ProcessorService.insertTestData",
        data: {},
      }),
    )

    expect(result).toBe("Test data inserted")
  })

  it("Should fail to upload attachment to non-existent entity", async () => {
    const incidentID = await newIncident(POST, "admin")
    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${cds.utils.uuid()})/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      },
    ).catch((e) => {
      expect(e.status).toEqual(404)
      expect(e.response.data.error.message).toMatch(/Not Found/)
    })
  })

  it("Should fail to update note for non-existent attachment", async () => {
    const incidentID = await newIncident(POST, "admin")
    await PATCH(
      `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${cds.utils.uuid()})`,
      { note: "This should fail" },
      { headers: { "Content-Type": "application/json" } },
    ).catch((e) => {
      expect(e.status).toEqual(404)
      expect(e.response.data.error.message).toMatch(/Not Found/)
    })
  })

  it("Malware scanning does not happen when scan is disabled", async () => {
    const incidentID = await newIncident(POST, "processor")
    cds.env.requires.attachments.scan = false

    // Upload attachment using helper function
    let sampleDocID = await uploadDraftAttachment(
      utils,
      POST,
      PUT,
      GET,
      incidentID,
    )
    expect(sampleDocID).toBeTruthy()

    //read attachments list for Incident
    const attachmentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )
    //the data should have only one attachment
    expect(attachmentResponse.status).toEqual(200)
    expect(attachmentResponse.data.value.length).toEqual(1)
    //to make sure content is not read
    expect(attachmentResponse.data.value[0].content).toBeFalsy()
    sampleDocID = attachmentResponse.data.value[0].ID

    // Check Scanning status
    const scanResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )
    expect(scanResponse.status).toEqual(200)
    expect(scanResponse.data.value.length).toEqual(1)

    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse.status).toEqual(200)
    expect(contentResponse.data).toBeTruthy()

    const resultResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )
    expect(resultResponse.status).toEqual(200)

    expect(log.output.length).toBeGreaterThan(0)
    expect(log.output).not.toContain("Initiating malware scan request")
    expect(log.output).toContain(
      "Malware scanner is disabled! Please consider enabling it",
    )

    cds.env.requires.attachments.scan = true
  })

  it("Uploading attachment to Test works and scan status is set", async () => {
    // Create a Test entity
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, {
      ID: testID,
      name: "Test Entity",
    })

    // Upload attachment
    const res = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments`,
      {
        up__ID: testID,
        filename: "testfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(res.data.ID).not.toBeNull()

    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${res.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      },
    )

    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Test that attachment exists and scan status
    const getRes = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=true)/attachments`,
    )
    expect(getRes.status).toEqual(200)
    expect(getRes.data.value.length).toEqual(1)
    expect(["Scanning", "Clean", "Unscanned"]).toContain(
      getRes.data.value[0].status,
    )
  })

  it("Uploading attachment to nested Test works and scan status is set", async () => {
    // Create a Test entity
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, {
      ID: testID,
      name: "Test Entity",
      attachments: [
        {
          up__ID: testID,
          filename: "testfile.pdf",
          mimeType: "application/pdf",
          createdAt: new Date(),
          createdBy: "alice",
        },
      ],
    })

    const getAtt = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments`,
    )

    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${getAtt.data.value[0].ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      },
    )

    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Test that attachment exists and scan status
    const getRes = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=true)/attachments`,
    )
    expect(getRes.status).toEqual(200)
    expect(getRes.data.value.length).toEqual(1)
    expect(["Scanning", "Clean", "Unscanned"]).toContain(
      getRes.data.value[0].status,
    )
  })

  it("Creating Test with nested entity and attachments", async () => {
    // Create a Test entity
    const testID = cds.utils.uuid()
    const detailsID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, {
      ID: testID,
      name: "Test Entity",
      attachments: [
        {
          up__ID: testID,
          filename: "testfile.pdf",
          mimeType: "application/pdf",
          createdAt: new Date(),
          createdBy: "alice",
        },
      ],
      details: [
        {
          ID: detailsID,
          description: "Test Details Entity",
          attachments: [
            {
              up__ID: detailsID,
              filename: "detailsfile.pdf",
              mimeType: "application/pdf",
              createdAt: new Date(),
              createdBy: "alice",
            },
          ],
        },
      ],
    })

    // Get parent attachment
    const getParentAtt = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments`,
    )
    const parentAttID = getParentAtt.data.value[0].ID

    // Get child attachment
    const getChildAtt = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments`,
    )
    const childAttID = getChildAtt.data.value[0].ID

    // Upload file content for parent attachment
    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${parentAttID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      },
    )

    // Upload file content for child attachment
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments(up__ID=${detailsID},ID=${childAttID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      },
    )

    // Save the draft
    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Test that parent attachment exists and scan status
    const getResParent = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=true)/attachments`,
    )
    expect(getResParent.status).toEqual(200)
    expect(getResParent.data.value.length).toEqual(1)
    expect(["Scanning", "Clean", "Unscanned"]).toContain(
      getResParent.data.value[0].status,
    )

    // Test that child attachment exists and scan status
    const getResChild = await GET(
      `odata/v4/processor/TestDetails(ID=${detailsID},IsActiveEntity=true)/attachments`,
    )
    expect(getResChild.status).toEqual(200)
    expect(getResChild.data.value.length).toEqual(1)
    expect(["Scanning", "Clean", "Unscanned"]).toContain(
      getResChild.data.value[0].status,
    )
  })

  it("Uploading attachment to TestDetails works and scan status is set", async () => {
    // Create a Test entity
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, {
      ID: testID,
      name: "Test Entity",
    })

    // Add TestDetails entity
    const detailsID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details`,
      {
        ID: detailsID,
        description: "Test Details Entity",
      },
    )

    // Upload attachment
    const res = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments`,
      {
        up__ID: detailsID,
        filename: "detailsfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(res.data.ID).not.toBeNull()

    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments(up__ID=${detailsID},ID=${res.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      },
    )

    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Test that attachment exists and scan status
    const getRes = await GET(
      `odata/v4/processor/TestDetails(ID=${detailsID},IsActiveEntity=true)/attachments`,
    )
    expect(getRes.status).toEqual(200)
    expect(getRes.data.value.length).toEqual(1)
    expect(["Scanning", "Clean", "Unscanned"]).toContain(
      getRes.data.value[0].status,
    )
  })

  it("Attachment content on TestDetails is downloadable after draft activation (depth-2 named back-assoc)", async () => {
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, {
      ID: testID,
      name: "Test Entity for nested draft save",
    })

    const detailsID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details`,
      {
        ID: detailsID,
        description: "Details for nested draft save test",
      },
    )

    const attachRes = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments`,
      {
        up__ID: detailsID,
        filename: "nested-draft.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachRes.data.ID).toBeTruthy()

    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments(up__ID=${detailsID},ID=${attachRes.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      },
    )

    const draftContent = await GET(
      `/odata/v4/processor/TestDetails_attachments(up__ID=${detailsID},ID=${attachRes.data.ID},IsActiveEntity=false)/content`,
    )
    expect(draftContent.status).toEqual(200)
    expect(draftContent.data).toBeTruthy()

    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    const activeContent = await GET(
      `/odata/v4/processor/TestDetails_attachments(up__ID=${detailsID},ID=${attachRes.data.ID},IsActiveEntity=true)/content`,
    )
    expect(activeContent.status).toEqual(200)
    expect(activeContent.data).toBeTruthy()
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

    await GET(
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

  it("Attachment content at depth 3 (Level0 -> Level1 -> Level2 -> attachments) is downloadable after draft activation", async () => {
    const level0ID = cds.utils.uuid()
    await POST(`odata/v4/processor/Level0`, {
      ID: level0ID,
      name: "Depth-3 test root",
    })

    const level1ID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Level0(ID=${level0ID},IsActiveEntity=false)/children`,
      {
        ID: level1ID,
        name: "Level1 child",
      },
    )

    const level2ID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Level0(ID=${level0ID},IsActiveEntity=false)/children(ID=${level1ID},IsActiveEntity=false)/children`,
      {
        ID: level2ID,
        name: "Level2 grandchild",
      },
    )

    const attachRes = await POST(
      `odata/v4/processor/Level0(ID=${level0ID},IsActiveEntity=false)/children(ID=${level1ID},IsActiveEntity=false)/children(ID=${level2ID},IsActiveEntity=false)/attachments`,
      {
        up__ID: level2ID,
        filename: "depth3.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachRes.data.ID).toBeTruthy()

    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/processor/Level2_attachments(up__ID=${level2ID},ID=${attachRes.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      },
    )

    const draftContent = await GET(
      `/odata/v4/processor/Level2_attachments(up__ID=${level2ID},ID=${attachRes.data.ID},IsActiveEntity=false)/content`,
    )
    expect(draftContent.status).toEqual(200)

    await utils.draftModeSave(
      "processor",
      "Level0",
      level0ID,
      "ProcessorService",
    )

    const activeContent = await GET(
      `/odata/v4/processor/Level2_attachments(up__ID=${level2ID},ID=${attachRes.data.ID},IsActiveEntity=true)/content`,
    )
    expect(activeContent.status).toEqual(200)
    expect(activeContent.data).toBeTruthy()
  })

  it("Attachment content at depth 4 (Level0 -> Level1 -> Level2 -> Level3 -> attachments) is downloadable after draft activation", async () => {
    const level0ID = cds.utils.uuid()
    await POST(`odata/v4/processor/Level0`, {
      ID: level0ID,
      name: "Depth-4 test root",
    })

    const level1ID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Level0(ID=${level0ID},IsActiveEntity=false)/children`,
      {
        ID: level1ID,
        name: "Level1 child",
      },
    )

    const level2ID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Level0(ID=${level0ID},IsActiveEntity=false)/children(ID=${level1ID},IsActiveEntity=false)/children`,
      {
        ID: level2ID,
        name: "Level2 grandchild",
      },
    )

    const level3ID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Level0(ID=${level0ID},IsActiveEntity=false)/children(ID=${level1ID},IsActiveEntity=false)/children(ID=${level2ID},IsActiveEntity=false)/items`,
      {
        ID: level3ID,
        name: "Level3 great-grandchild",
      },
    )

    // Upload attachment to Level3 (depth 4)
    const attachRes = await POST(
      `odata/v4/processor/Level0(ID=${level0ID},IsActiveEntity=false)/children(ID=${level1ID},IsActiveEntity=false)/children(ID=${level2ID},IsActiveEntity=false)/items(ID=${level3ID},IsActiveEntity=false)/attachments`,
      {
        up__ID: level3ID,
        filename: "depth4.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachRes.data.ID).toBeTruthy()

    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/processor/Level3_attachments(up__ID=${level3ID},ID=${attachRes.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      },
    )

    const draftContent = await GET(
      `/odata/v4/processor/Level3_attachments(up__ID=${level3ID},ID=${attachRes.data.ID},IsActiveEntity=false)/content`,
    )
    expect(draftContent.status).toEqual(200)

    await utils.draftModeSave(
      "processor",
      "Level0",
      level0ID,
      "ProcessorService",
    )

    const activeContent = await GET(
      `/odata/v4/processor/Level3_attachments(up__ID=${level3ID},ID=${attachRes.data.ID},IsActiveEntity=true)/content`,
    )
    expect(activeContent.status).toEqual(200)
    expect(activeContent.data).toBeTruthy()
  })

  it("Should reflect all attachment compositions on parent entity", async () => {
    const Catalog = await cds.connect.to("ProcessorService")
    const Test = Catalog.entities.Test
    const TestDetails = Catalog.entities.TestDetails

    // Create a Test entity
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, { ID: testID, name: "Test Entity" })

    // Add a TestDetails entity with attachments
    const detailsID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details`,
      { ID: detailsID, description: "Test Details Entity" },
    )

    // Now check the parent's _attachments properties
    expect(Test._attachments.hasAttachmentsComposition).toBe(true)
    expect(Object.keys(Test._attachments.attachmentCompositions).length).toBe(2)
    expect(TestDetails._attachments.hasAttachmentsComposition).toBe(true)
    expect(
      Object.keys(TestDetails._attachments.attachmentCompositions).length,
    ).toBe(1)
  })

  it("Deleting Test deletes Test attachment", async () => {
    // Create Test entity and add attachment
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, { ID: testID, name: "Test Entity" })
    const attachRes = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments`,
      {
        up__ID: testID,
        filename: "testfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachRes.data.ID).not.toBeNull()
    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")
    // Delete the parent Test entity
    const delRes = await DELETE(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=true)`,
    )
    expect(delRes.status).toEqual(204)

    // Check that the attachment is deleted
    let error
    try {
      await GET(
        `odata/v4/processor/Test_attachments(up__ID=${testID},ID=${attachRes.data.ID},IsActiveEntity=true)`,
      )
    } catch (e) {
      error = e
    }
    expect(error?.response?.status || error?.status).toEqual(404)
  })

  it("Deleting TestDetails deletes TestDetails attachment", async () => {
    // Create Test and TestDetails entities
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, { ID: testID, name: "Test Entity" })
    const detailsID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details`,
      { ID: detailsID, description: "Test Details Entity" },
    )
    // Add attachment to TestDetails
    const attachRes = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments`,
      {
        up__ID: detailsID,
        filename: "detailsfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachRes.data.ID).not.toBeNull()
    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Delete the child TestDetails entity
    const delRes = await DELETE(
      `odata/v4/processor/TestDetails(ID=${detailsID},IsActiveEntity=true)`,
    )
    expect(delRes.status).toEqual(204)

    // Check that the attachment is deleted
    let error
    try {
      await GET(
        `odata/v4/processor/TestDetails_attachments(up__ID=${detailsID},ID=${attachRes.data.ID},IsActiveEntity=true)`,
      )
    } catch (e) {
      error = e
    }
    expect(error?.response?.status || error?.status).toEqual(404)
  })

  it("Deleting Test deletes both Test and TestDetails attachments", async () => {
    const scanCleanWaiter = waitForScanStatus("Clean")
    // Create Test and TestDetails entities
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, { ID: testID, name: "Test Entity" })

    const attachResTest = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments`,
      {
        up__ID: testID,
        filename: "testfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachResTest.data.ID).not.toBeNull()

    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${attachResTest.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      },
    )

    const detailsID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details`,
      { ID: detailsID, description: "Test Details Entity" },
    )
    // Add attachment to TestDetails
    const attachResDetails = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments`,
      {
        up__ID: detailsID,
        filename: "detailsfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachResDetails.data.ID).not.toBeNull()
    await scanCleanWaiter
    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Delete the child TestDetails entity
    const delRes = await DELETE(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=true)`,
    )
    expect(delRes.status).toEqual(204)

    // Check that the attachment is deleted
    let error
    try {
      await GET(
        `odata/v4/processor/Test_attachments(up__ID=${testID},ID=${attachResTest.data.ID},IsActiveEntity=true)`,
      )
    } catch (e) {
      error = e
    }
    expect(error?.response?.status || error?.status).toEqual(404)
    error = null

    try {
      await GET(
        `odata/v4/processor/TestDetails_attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID},IsActiveEntity=true)`,
      )
    } catch (e) {
      error = e
    }
    expect(error?.response?.status || error?.status).toEqual(404)
  })

  it("Canceling a draft removes all unsaved added attachments from parent and child entities", async () => {
    // Create parent entity in draft mode
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, {
      ID: testID,
      name: "Draft Cancel Test",
    })

    // Add attachment to parent
    const attachResParent = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments`,
      {
        up__ID: testID,
        filename: "parentfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachResParent.data.ID).toBeTruthy()

    // Add child entity and attachment
    const detailsID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details`,
      { ID: detailsID, description: "Draft Cancel Child" },
    )
    const attachResChild = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments`,
      {
        up__ID: detailsID,
        filename: "childfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachResChild.data.ID).toBeTruthy()

    // Cancel the draft
    const cancelRes = await DELETE(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)`,
    )
    expect(cancelRes.status).toEqual(204)

    // Check that parent attachment is deleted
    let error
    try {
      await GET(
        `odata/v4/processor/Test_attachments(up__ID=${testID},ID=${attachResParent.data.ID},IsActiveEntity=true)`,
      )
    } catch (e) {
      error = e
    }
    expect(error?.response?.status || error?.status).toEqual(404)
    error = null

    // Check that child attachment is deleted
    try {
      await GET(
        `odata/v4/processor/TestDetails_attachments(up__ID=${detailsID},ID=${attachResChild.data.ID},IsActiveEntity=true)`,
      )
    } catch (e) {
      error = e
    }
    expect(error?.response?.status || error?.status).toEqual(404)
  })

  it("Canceling a draft does not remove any unsaved deleted attachments from parent and child entities", async () => {
    // Create parent entity in draft mode
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, {
      ID: testID,
      name: "Draft Cancel Test",
    })

    // Add child entity and attachment
    const detailsID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details`,
      { ID: detailsID, description: "Draft Cancel Child" },
    )

    // Add attachment to parent
    const attachResParent = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments`,
      {
        up__ID: testID,
        filename: "parentfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachResParent.data.ID).toBeTruthy()

    const attachResChild = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments`,
      {
        up__ID: detailsID,
        filename: "childfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachResChild.data.ID).toBeTruthy()

    // Save the draft
    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Start editing again (create a new draft)
    await utils.draftModeEdit("processor", "Test", testID, "ProcessorService")

    // Delete attachments in the draft
    await DELETE(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${attachResParent.data.ID},IsActiveEntity=false)`,
    )
    await DELETE(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments(up__ID=${detailsID},ID=${attachResChild.data.ID},IsActiveEntity=false)`,
    )

    // Discard the draft (do NOT save)
    const discardRes = await DELETE(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)`,
    )
    expect(discardRes.status).toEqual(204)

    // Check that parent attachment is still present
    const parentAttachment = await GET(
      `odata/v4/processor/Test_attachments(up__ID=${testID},ID=${attachResParent.data.ID},IsActiveEntity=true)`,
    )
    expect(parentAttachment.status).toEqual(200)
    expect(parentAttachment.data.ID).toEqual(attachResParent.data.ID)
    expect(parentAttachment.data.filename).toBe("parentfile.pdf")

    // Check that child attachment is still present
    const childAttachment = await GET(
      `odata/v4/processor/TestDetails_attachments(up__ID=${detailsID},ID=${attachResChild.data.ID},IsActiveEntity=true)`,
    )
    expect(childAttachment.status).toEqual(200)
    expect(childAttachment.data.ID).toEqual(attachResChild.data.ID)
    expect(childAttachment.data.filename).toBe("childfile.pdf")
  })

  it("Should not allow end user to set or change url from api", async () => {
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, { ID: testID, name: "Test Entity" })

    // Try to create an attachment with a custom url
    const maliciousUrl = "malicious-file-key"
    const res = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments`,
      {
        up__ID: testID,
        filename: "testfile.pdf",
        mimeType: "application/pdf",
        url: maliciousUrl,
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(res.data.ID).toBeTruthy()

    const getRes = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${res.data.ID},IsActiveEntity=false)`,
    )
    expect(getRes.status).toBe(200)
    expect(getRes.data.url).not.toBe(maliciousUrl)
    expect(getRes.data.url).toBeTruthy()

    // Try to PATCH the url
    const newMaliciousUrl = "malicious-patch-key"
    await PATCH(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${res.data.ID},IsActiveEntity=false)`,
      { url: newMaliciousUrl },
    )

    const getRes2 = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${res.data.ID},IsActiveEntity=false)`,
    )
    expect(getRes2.status).toBe(200)
    expect(getRes2.data.url).not.toBe(newMaliciousUrl)
    expect(getRes2.data.url).not.toBe(maliciousUrl)
    expect(getRes2.data.url).toBeTruthy()
  })

  // prettier-ignore
  isNotLocal("Should detect and automatically delete infected files after scan", async () => {
    const incidentID = await newIncident(POST, "processor")
    const testMal =
      "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo="
    const fileContent = Buffer.from(testMal, "base64").toString("utf8")

    const scanInfectedWaiter = waitForScanStatus("Infected")

    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )
    const res = await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "testmal.png",
        mimeType: "image/png",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(res.data.ID).toBeTruthy()

    const deletionWaiter = waitForMalwareDeletion(res.data.ID)

    await PUT(
      `/odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${res.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": fileContent.length,
        },
      },
    )

    await utils.draftModeSave(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    // Check that status is "infected" after scan
    await scanInfectedWaiter

    // Wait for deletion to complete
    await deletionWaiter
  })

  it("Must delete discarded files from the object store when active entity exists", async () => {
    const incidentID = await newIncident(POST, "processor")
    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)
    const attachmentData = {
      up__ID: incidentID,
      filename: basename(filepath),
      mimeType: "application/pdf",
    }

    const createResponse = await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      attachmentData,
    )
    const attachmentID = createResponse.data.ID
    expect(attachmentID).toBeTruthy()

    const putResponse = await PUT(
      `/odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${attachmentID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.byteLength,
        },
      },
    )
    expect(putResponse.status).toBe(204)

    // Need the URL of the attachment to confirm its deletion later
    const getResponse = await GET(
      `odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${attachmentID},IsActiveEntity=false)`,
    )
    const attachmentUrl = getResponse.data.url
    expect(attachmentUrl).toBeTruthy()

    const deletionWaiter = waitForDeletion(attachmentUrl)

    const discardResponse = await DELETE(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)`,
    )
    expect(discardResponse.status).toBe(204)

    await deletionWaiter
  })

  it("Must delete discarded files from the object store when no active entity exists", async () => {
    // Create a new draft incident directly without saving it first
    const incidentID = cds.utils.uuid()
    await POST(`odata/v4/processor/Incidents`, {
      ID: incidentID,
      title: "New Draft Incident",
    })

    const filepath = join(__dirname, "content/sample.pdf")
    const fileContent = readFileSync(filepath)
    const attachmentData = {
      up__ID: incidentID,
      filename: basename(filepath),
      mimeType: "application/pdf",
    }

    const createResponse = await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      attachmentData,
    )
    const attachmentID = createResponse.data.ID
    expect(attachmentID).toBeTruthy()

    const putResponse = await PUT(
      `/odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${attachmentID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.byteLength,
        },
      },
    )
    expect(putResponse.status).toBe(204)

    // Need the URL of the attachment to confirm its deletion later
    const getResponse = await GET(
      `odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${attachmentID},IsActiveEntity=false)`,
    )
    const attachmentUrl = getResponse.data.url
    expect(attachmentUrl).toBeTruthy()

    const deletionWaiter = waitForDeletion(attachmentUrl)

    const discardResponse = await DELETE(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)`,
    )
    expect(discardResponse.status).toBe(204)

    await deletionWaiter
  })

  it("Should not delete a new attachment when saving a draft of an existing entity", async () => {
    const scanCleanWaiter = waitForScanStatus("Clean")

    const incidentID = await newIncident(POST, "processor")
    await utils.draftModeSave(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    // Upload an attachment
    const attachmentID = await uploadDraftAttachment(
      utils,
      POST,
      PUT,
      GET,
      incidentID,
    )
    expect(attachmentID).toBeTruthy()
    await scanCleanWaiter

    // Verify the attachment is downloadable after saving
    const contentResponse1 = await GET(
      `/odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${attachmentID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse1.status).toEqual(200)

    // Edit the draft again
    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    // Ensure the attachment is downloadable when re-entering draft mode
    const contentResponse2 = await GET(
      `/odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
    )
    expect(contentResponse2.status).toEqual(200)
    expect(contentResponse2.data.value[0].ID).toEqual(attachmentID)
  })

  it("Creating attachment with content in POST returns the posted metadata", async () => {
    const incidentID = await newIncident(POST, "processor")
    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const filename = "sample.pdf"
    const mimeType = "application/pdf"

    const response = await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename,
        mimeType,
        content: createReadStream(join(__dirname, "content/sample.pdf")),
      },
    )

    expect(response.status).toEqual(201)
    expect(response.data).toMatchObject({
      up__ID: incidentID,
      filename,
      mimeType,
    })
    expect(response.data.ID).toBeTruthy()
    expect(response.data.status).toBeDefined()
  })

  it("Updating parent should not cause attachment deletes", async () => {
    const incidentID = await newIncident(POST, "processor")
    let sampleDocID
    const scanCleanWaiter = waitForScanStatus("Clean")
    // Upload attachment using helper function
    sampleDocID = await uploadDraftAttachment(utils, POST, PUT, GET, incidentID)
    expect(sampleDocID).toBeTruthy()

    //read attachments list for Incident
    const attachmentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )
    //the data should have only one attachment
    expect(attachmentResponse.status).toEqual(200)
    expect(attachmentResponse.data.value.length).toEqual(1)
    sampleDocID = attachmentResponse.data.value[0].ID

    await scanCleanWaiter

    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse.status).toEqual(200)
    expect(contentResponse.data).toBeTruthy()

    const resultResponse = await PATCH(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)`,
      {
        status_code: "N",
      },
    )
    expect(resultResponse.status).toEqual(200)

    try {
      await waitForDeletion(attachmentResponse.data.value[0].url)
      // Should throw due to timeout
      expect(true).toEqual(false)
    } catch (error) {
      expect(error.message.startsWith("Timeout waiting for deletion")).toEqual(
        true,
      )
    }

    const contentAfterActiveUpdate = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    expect(contentAfterActiveUpdate.status).toEqual(200)
    expect(contentAfterActiveUpdate.data).toBeTruthy()
  })

  // prettier-ignore
  isNotLocal("Programmatic SELECT with columns('content') returns bytes from object store", async () => {
    const incidentID = await newIncident(POST, "processor")
    const scanCleanWaiter = waitForScanStatus("Clean")

    await uploadDraftAttachment(utils, POST, PUT, GET, incidentID)
    await scanCleanWaiter

    const srv = await cds.connect.to("ProcessorService")
    const Attachments = srv.entities["Incidents.attachments"]

    const result = await runWithUser(alice, () =>
      SELECT.one
        .from(Attachments)
        .columns("content")
        .where({ up__ID: incidentID }),
    )

    expect(result).toBeTruthy()
    const chunks = []
    await new Promise((resolve, reject) => {
      result.content.on("data", (chunk) => chunks.push(chunk))
      result.content.on("end", resolve)
      result.content.on("error", reject)
    })
    expect(Buffer.concat(chunks).length).toBeGreaterThan(0)
  })

  // prettier-ignore
  isNotLocal("Should emit DeleteAttachment when active Incident entity is deleted without open draft", async () => {
    const incidentID = await newIncident(POST, "processor")
    const scanCleanWaiter = waitForScanStatus("Clean")
    const sampleDocID = await uploadDraftAttachment(
      utils,
      POST,
      PUT,
      GET,
      incidentID,
    )
    await scanCleanWaiter

    const { data: attachmentData } = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)`,
    )
    expect(attachmentData.url).toBeTruthy()

    const deletionWaiter = waitForDeletion(attachmentData.url)

    await DELETE(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)`,
    )

    expect(await deletionWaiter).toBe(true)
  })
})
