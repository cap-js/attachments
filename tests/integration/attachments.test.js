const cds = require("@sap/cds")
const { RequestSend } = require("../utils/api")
const {
  waitForScanStatus,
  newIncident,
  delay,
  waitForMalwareDeletion,
  waitForDeletion,
  runWithUser,
} = require("../utils/testUtils")
const { createReadStream, readFileSync } = cds.utils.fs
const { join, basename } = cds.utils.path
const { Readable } = require("stream")

const app = join(__dirname, "../incidents-app")
const { axios, GET, POST, DELETE, PATCH, PUT } = cds.test(app)
axios.defaults.auth = { username: "alice" }
const alice = new cds.User({ id: "alice", roles: { admin: 1, support: 1 } })

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
        req.query.UPDATE.data.status &&
        req.target.name.includes(".attachments")
      ) {
        ScanStates.push(req.query.UPDATE.data.status)
      }
    })
    // Upload attachment using helper function
    sampleDocID = await uploadDraftAttachment(utils, POST, GET, incidentID)
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
        req.query.UPDATE.data.status &&
        req.target.name.includes(".attachments")
      ) {
        ScanStates.push(req.query.UPDATE.data.status)
      }
    })
    // Upload attachment using helper function
    sampleDocID = await uploadDraftAttachment(utils, POST, GET, incidentID)
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

    // Wait for 45 seconds to let the scan status expire
    await delay(45 * 1000)

    await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    ).catch((e) => {
      expect(e.status).toEqual(202)
      expect(e.response.data.error.message).toContain(
        "The last scan is older than 3 days. Please wait while the attachment is being re-scanned.",
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
    sampleDocID = await uploadDraftAttachment(utils, POST, GET, incidentID)
    expect(sampleDocID).toBeTruthy()

    // Wait for scanning to complete
    await scanCleanWaiter

    //check the content of the uploaded attachment in main table
    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse.status).toEqual(200)

    const attachmentData = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)`,
    )

    //trigger to delete attachment
    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const db = await cds.connect.to("db")
    const attachmentIDs = []
    db.before("*", (req) => {
      if (
        req.event === "CREATE" &&
        req.target?.name === "cds.outbox.Messages"
      ) {
        const msg = JSON.parse(req.query.INSERT.entries[0].msg)
        attachmentIDs.push(msg.data.url)
      }
    })

    //delete attachment
    await DELETE(
      `odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=false)`,
    )

    await utils.draftModeSave(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    expect(attachmentIDs[0]).toEqual(attachmentData.data.url)
    expect(attachmentIDs.length).toEqual(1)

    //read attachments list for Incident
    const response = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`,
    )
    //the data should have no attachments
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

  it("Discarding a saved draft should not delete attachment content", async () => {
    const incidentID = await newIncident(POST, "processor")
    const scanCleanWaiter = waitForScanStatus("Clean")

    const sampleDocID = await uploadDraftAttachment(
      utils,
      POST,
      GET,
      incidentID,
    )
    expect(sampleDocID).toBeTruthy()
    await scanCleanWaiter

    const contentResponse1 = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse1.status).toEqual(200)
    expect(contentResponse1.data).toBeTruthy()

    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    const discardResponse = await DELETE(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)`,
    )
    expect(discardResponse.status).toEqual(204)

    // Verify the attachment content STILL exists
    const contentResponse2 = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    expect(contentResponse2.status).toEqual(200)
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

  it("should fail to upload attachment to non-existent entity", async () => {
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

  it("should fail to update note for non-existent attachment", async () => {
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
    let sampleDocID = await uploadDraftAttachment(utils, POST, GET, incidentID)
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
    sampleDocID = await uploadDraftAttachment(utils, POST, GET, incidentID)
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

    const scanCleanWaiter2 = waitForScanStatus("Clean")
    try {
      await waitForDeletion(attachmentResponse.data.value[0].url)
      // Should throw due to timeout
      expect(true).toEqual(false)
    } catch (error) {
      expect(error.message.startsWith("Timeout waiting for deletion")).toEqual(
        true,
      )
    }

    // Second scan round needed due to scan expiry limit for other tests. Triggered via rescan
    await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    await scanCleanWaiter2
    const contentAfterActiveUpdate = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`,
    )
    expect(contentAfterActiveUpdate.status).toEqual(200)
    expect(contentAfterActiveUpdate.data).toBeTruthy()
  })
})

describe("Tests for attachments facet disable", () => {
  beforeAll(async () => {
    // Initialize test variables
    utils = new RequestSend(POST)
  })

  it("Hide up ID on Attachments UI", async () => {
    const res = await GET(`odata/v4/processor/$metadata?$format=json`)
    expect(res.status).toEqual(200)
    expect(
      res.data.ProcessorService.$Annotations[
        "ProcessorService.Incidents_attachments/up__ID"
      ]?.["@UI.Hidden"],
    ).toEqual(true)
    expect(
      res.data.ProcessorService.$Annotations[
        "ProcessorService.Incidents_attachments/up_"
      ]?.["@UI.Hidden"],
    ).toEqual(true)
  })

  it("Checking attachments facet metadata when @UI.Hidden is undefined", async () => {
    const res = await GET(`odata/v4/processor/$metadata?$format=json`)
    expect(res.status).toEqual(200)
    const facets =
      res.data.ProcessorService.$Annotations["ProcessorService.Incidents"][
        "@UI.Facets"
      ]
    const attachmentsFacetLabel = facets.some(
      (facet) => facet.Label === "Attachments",
    )
    const attachmentsFacetTarget = facets.some(
      (facet) => facet.Target === "attachments/@UI.LineItem",
    )
    expect(attachmentsFacetLabel).toBeTruthy()
    expect(attachmentsFacetTarget).toBeTruthy()
  })

  it("Checking attachments facet when @attachments.disable_facet is enabled", async () => {
    const res = await GET(`odata/v4/processor/$metadata?$format=json`)
    expect(res.status).toEqual(200)
    const facets =
      res.data.ProcessorService.$Annotations["ProcessorService.Incidents"][
        "@UI.Facets"
      ]
    const hiddenAttachmentsFacetLabel = facets.some(
      (facet) => facet.Label === "Attachments",
    )

    //Checking the facet metadata for hiddenAttachments since its annotated with @attachments.disable_facet as enabled
    const hiddenAttachmentsFacetTarget = facets.some(
      (facet) => facet.Target === "hiddenAttachments/@UI.LineItem",
    )
    expect(hiddenAttachmentsFacetLabel).toBeTruthy()
    expect(hiddenAttachmentsFacetTarget).toBeFalsy()
  })

  it("Checking attachments facet when @UI.Hidden is enabled", async () => {
    const res = await GET(`odata/v4/processor/$metadata?$format=json`)
    expect(res.status).toEqual(200)
    const facets =
      res.data.ProcessorService.$Annotations["ProcessorService.Incidents"][
        "@UI.Facets"
      ]
    const hiddenAttachmentsFacetLabel = facets.some(
      (facet) => facet.Label === "Attachments",
    )

    const hiddenAttachmentsFacetTarget = facets.find(
      (facet) => facet.Target === "hiddenAttachments2/@UI.LineItem",
    )
    expect(hiddenAttachmentsFacetLabel).toBeTruthy()
    expect(!!hiddenAttachmentsFacetTarget).toBeTruthy()
    expect(hiddenAttachmentsFacetTarget["@UI.Hidden"]).toEqual(true)
  })

  it("Attachments facet is not added when its manually added by the developer", async () => {
    const res = await GET(`odata/v4/processor/$metadata?$format=json`)
    expect(res.status).toEqual(200)
    const facets =
      res.data.ProcessorService.$Annotations["ProcessorService.Customers"][
        "@UI.Facets"
      ]

    const attachmentFacets = facets.filter(
      (facet) => facet.Target === "attachments/@UI.LineItem",
    )
    expect(attachmentFacets.length).toEqual(1)
    expect(attachmentFacets[0].Label).toEqual("My custom attachments")
  })
})

describe("Tests for acceptable media types", () => {
  beforeAll(async () => {
    // Initialize test variables
    utils = new RequestSend(POST)
  })

  it("Uploading attachment with disallowed mime type", async () => {
    const incidentID = await newIncident(POST, "processor")
    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    let expectedError
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/mediaTypeAttachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/pdf",
        content: createReadStream(join(__dirname, "content/sample.pdf")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    ).catch((e) => {
      expectedError = e
    })
    expect(expectedError.status).toEqual(400)
    expect(expectedError.response.data.error.message).toMatch(
      "The attachment file type 'application/pdf' is not allowed.",
    )
  })

  it("Uploading attachment with disallowed mime type and boundary specified", async () => {
    const incidentID = await newIncident(POST, "processor")
    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    let expectedError
    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/mediaTypeAttachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/pdf boundary=something",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        content: createReadStream(join(__dirname, "content/sample.pdf")),
        createdBy: "alice",
      },
    ).catch((e) => {
      expectedError = e
    })
    expect(expectedError.status).toEqual(400)
    expect(expectedError.response.data.error.message).toMatch(
      "The attachment file type 'application/pdf' is not allowed",
    )
  })

  it("Uploading attachment with disallowed mime type and charset specified", async () => {
    const incidentID = await newIncident(POST, "processor")
    await utils.draftModeEdit(
      "processor",
      "Incidents",
      incidentID,
      "ProcessorService",
    )

    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/mediaTypeAttachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg charset=UTF-8",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    ).catch((e) => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.message).toMatch(
        "The attachment file type 'application/pdf' is not allowed.",
      )
    })
  })
})

describe("Testing max and min amounts of attachments", () => {
  beforeAll(async () => {
    utils = new RequestSend(POST)
  })

  it("Create of record in draft gives warning when maximum is met", async () => {
    const incidentID = await newIncident(POST, "validation-test")

    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    )
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    )
    const { status: postStatus } = await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    )
    expect(postStatus).toEqual(201)

    const { response } = await utils.draftModeSave(
      "validation-test",
      "Incidents",
      incidentID,
      "ValidationTestService",
    )
    expect(response.status).toEqual(400)
    expect(response.data.error.code).toEqual("MaximumAmountExceeded")
    expect(response.data.error.target).toEqual("attachments")
  })

  it("Delete of record in draft gives warning when minimum is not met", async () => {
    const incidentID = await newIncident(POST, "validation-test")

    const { data: newAttachment } = await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    )
    const { status: deleteStatus } = await DELETE(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments(up__ID=${incidentID},ID=${newAttachment.ID},IsActiveEntity=false)`,
    )

    expect(deleteStatus).toEqual(204)

    const { response } = await utils.draftModeSave(
      "validation-test",
      "Incidents",
      incidentID,
      "ValidationTestService",
    )
    expect(response.status).toEqual(400)
    expect(response.data.error.code).toEqual("MinimumAmountNotFulfilled")
    expect(response.data.error.target).toEqual("attachments")
  })

  it("Deep create of new draft gives warning when minimum is not met or maximum exceeded", async () => {
    const incidentID = await newIncident(POST, "validation-test")

    const { status } = await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation`,
      {
        up__ID: incidentID,
        ID: cds.utils.uuid(),
        message: "ABC",
        attachments: [
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
            ),
            createdBy: "alice",
          },
        ],
      },
    )
    expect(status).toEqual(201)

    const { status: minStatus } = await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation`,
      {
        up__ID: incidentID,
        ID: cds.utils.uuid(),
        message: "ABC",
        attachments: [],
      },
    )
    expect(minStatus).toEqual(201)

    const { response: resMin } = await utils.draftModeSave(
      "validation-test",
      "Incidents",
      incidentID,
      "ValidationTestService",
    )
    expect(resMin.status).toEqual(400)
    const errMin = resMin.data.error.details.find((e) =>
      e.target.startsWith("conversation"),
    )
    expect(errMin.code).toEqual(
      "MinimumAmountNotFulfilled|ValidationTestService.Incidents.conversation",
    )

    const { status: postStatus } = await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation`,
      {
        up__ID: incidentID,
        ID: cds.utils.uuid(),
        message: "ABC",
        attachments: [
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
            ),
            createdBy: "alice",
          },
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
            ),
            createdBy: "alice",
          },
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
            ),
            createdBy: "alice",
          },
        ],
      },
    )
    expect(postStatus).toEqual(201)

    const { response } = await utils.draftModeSave(
      "validation-test",
      "Incidents",
      incidentID,
      "ValidationTestService",
    )
    expect(response.status).toEqual(400)
    const err = response.data.error.details.find(
      (e) =>
        e.target.startsWith("conversation") &&
        e.code === "MaximumAmountExceeded",
    )
    expect(err.code).toEqual("MaximumAmountExceeded")
  })

  it("Deep update of draft gives warning when minimum is not met or maximum exceeded", async () => {
    const incidentID = await newIncident(POST, "validation-test")

    const conversationID = cds.utils.uuid()
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation`,
      {
        ID: conversationID,
        message: "ABC",
      },
    )

    const { status } = await PATCH(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation(ID=${conversationID},IsActiveEntity=false)`,
      {
        message: "DEF",
        attachments: [
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
            ),
            createdBy: "alice",
            DraftAdministrativeData_DraftUUID: "12345",
          },
        ],
      },
    )
    expect(status).toEqual(200)

    await PATCH(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation(ID=${conversationID},IsActiveEntity=false)`,
      {
        message: "ABC",
        attachments: [],
      },
    ).catch((e) => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.code).toMatch(
        "MinimumAmountNotFulfilled|ValidationTestService.Incidents.conversation",
      )
    })

    await PATCH(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation(ID=${conversationID},IsActiveEntity=false)`,
      {
        message: "ABC",
        attachments: [
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
            ),
            createdBy: "alice",
            DraftAdministrativeData_DraftUUID: "12345",
          },
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
            ),
            createdBy: "alice",
            DraftAdministrativeData_DraftUUID: "12345",
          },
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
            ),
            createdBy: "alice",
            DraftAdministrativeData_DraftUUID: "12345",
          },
        ],
      },
    ).catch((e) => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.code).toMatch("MaximumAmountExceeded")
    })
  })

  it("On SAVE error is thrown when minimum is not met", async () => {
    const incidentID = await newIncident(POST, "validation-test")
    const { response } = await utils.draftModeSave(
      "validation-test",
      "Incidents",
      incidentID,
      "ValidationTestService",
    )
    expect(response.status).toEqual(400)
    expect(response.data.error.code).toEqual("MinimumAmountNotFulfilled")
  })

  it("On SAVE error is thrown when maximum is exceeded", async () => {
    const incidentID = await newIncident(POST, "validation-test")
    const {
      data: { ID: conversationID },
    } = await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation`,
      {
        message: "DEF",
      },
    )

    await PATCH(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation(ID=${conversationID},IsActiveEntity=false)`,
      {
        message: "DEF",
        attachments: [
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            content: createReadStream(join(__dirname, "content/sample-1.jpg")),
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
            ),
            createdBy: "alice",
            DraftAdministrativeData_DraftUUID: "12345",
          },
        ],
      },
    )
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    )
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    )
    await INSERT.into(
      cds.model.definitions["ValidationTestService.Incidents.attachments"]
        .drafts,
    ).entries({
      up__ID: incidentID,
      filename: "sample.pdf",
      mimeType: "application/jpeg; charset=UTF-8",
      createdAt: new Date(
        Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
      ),
      createdBy: "alice",
      DraftAdministrativeData_DraftUUID: "1234",
      IsActiveEntity: false,
    })
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/hiddenAttachments2`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    )

    const { response } = await utils.draftModeSave(
      "validation-test",
      "Incidents",
      incidentID,
      "ValidationTestService",
    )
    expect(response.status).toEqual(400)
    expect(response.data.error.code).toEqual("MaximumAmountExceeded")
  })

  it("On SAVE errors are thrown for nested attachments", async () => {
    const incidentID = await newIncident(POST, "validation-test")
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation`,
      {
        up__ID: incidentID,
        ID: cds.utils.uuid(),
        message: "ABC",
        attachments: [],
      },
    )
    const { response } = await utils.draftModeSave(
      "validation-test",
      "Incidents",
      incidentID,
      "ValidationTestService",
    )
    expect(response.status).toEqual(400)
    const errors = response.data.error.details.filter((e) =>
      e.target.startsWith("conversation"),
    )
    expect(errors.length).toEqual(1)
    for (const error of errors) {
      expect(error.code).toEqual(
        "MinimumAmountNotFulfilled|ValidationTestService.Incidents.conversation",
      )
    }
  })

  it("custom error message can be specified targeting composition property", async () => {
    const incidentID = await newIncident(POST, "validation-test")
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation`,
      {
        up__ID: incidentID,
        ID: cds.utils.uuid(),
        message: "ABC",
        attachments: [],
      },
    )
    const { response } = await utils.draftModeSave(
      "validation-test",
      "Incidents",
      incidentID,
      "ValidationTestService",
    )
    expect(response.status).toEqual(400)
    const err = response.data.error.details.find((e) =>
      e.target.startsWith("conversation"),
    )
    expect(err.code).toEqual(
      "MinimumAmountNotFulfilled|ValidationTestService.Incidents.conversation",
    )
  })

  it("custom error message can be specified for entity", async () => {
    const highIncID = await newIncident(POST, "validation-test", {
      title: `Incident ${Math.floor(Math.random() * 1000)}`,
      customer_ID: "1004155",
      urgency_code: "H",
    })
    const { response } = await utils.draftModeSave(
      "validation-test",
      "Incidents",
      highIncID,
      "ValidationTestService",
    )
    expect(response.status).toEqual(400)
    const err = response.data.error.details.find((e) =>
      e.target.startsWith("hiddenAttachments2"),
    )
    expect(err.code).toEqual(
      "MinimumAmountNotFulfilled|ValidationTestService.Incidents|hiddenAttachments2",
    )
  })

  it("On SAVE dynamic min/max is possible", async () => {
    const highIncID = await newIncident(POST, "validation-test", {
      title: `Incident ${Math.floor(Math.random() * 1000)}`,
      customer_ID: "1004155",
      urgency_code: "H",
    })
    // First with urgency_code = M - save, to few and to max
    await INSERT.into(
      cds.model.definitions["ValidationTestService.Incidents.hiddenAttachments"]
        .drafts,
    ).entries(
      {
        up__ID: highIncID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
        DraftAdministrativeData_DraftUUID: "1234",
        IsActiveEntity: false,
      },
      {
        up__ID: highIncID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
        DraftAdministrativeData_DraftUUID: "1234",
        IsActiveEntity: false,
      },
      {
        up__ID: highIncID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
        DraftAdministrativeData_DraftUUID: "1234",
        IsActiveEntity: false,
      },
    )

    const { response: res1 } = await utils.draftModeSave(
      "validation-test",
      "Incidents",
      highIncID,
      "ValidationTestService",
    )
    expect(res1.status).toEqual(400)
    const errMax1 = res1.data.error.details.find((e) =>
      e.target.startsWith("hiddenAttachments"),
    )
    expect(errMax1.code).toEqual("MaximumAmountExceeded")

    const errMin1 = res1.data.error.details.find((e) =>
      e.target.startsWith("hiddenAttachments2"),
    )
    expect(errMin1.code).toEqual(
      "MinimumAmountNotFulfilled|ValidationTestService.Incidents|hiddenAttachments2",
    )

    await PATCH(
      `odata/v4/validation-test/Incidents(ID=${highIncID},IsActiveEntity=false)`,
      {
        urgency_code: "M",
      },
    )

    await POST(
      `odata/v4/validation-test/Incidents(ID=${highIncID},IsActiveEntity=false)/attachments`,
      {
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    )

    const { status } = await utils.draftModeSave(
      "validation-test",
      "Incidents",
      highIncID,
      "ValidationTestService",
    )
    expect(status).toEqual(201)
  })
})

describe("Row-level security on attachments composition", () => {
  let restrictionID, attachmentID

  beforeAll(async () => {
    utils = new RequestSend(POST)
    const scanCleanWaiter = waitForScanStatus("Clean")
    // Create a Incidents entity as a Manager
    restrictionID = cds.utils.uuid()
    await POST(
      "/odata/v4/restriction/DraftIcidents",
      {
        ID: restrictionID,
        title: "ABC",
      },
      { auth: { username: "alice" } },
    )

    // Create an attachment as alice and save the ID
    const attachRes = await POST(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=false)/attachments`,
      {
        up__ID: restrictionID,
        filename: "test.pdf",
        mimeType: "application/pdf",
      },
      { auth: { username: "alice" } },
    )
    attachmentID = attachRes.data.ID

    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=false)/attachments(up__ID=${restrictionID},ID=${attachmentID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
        auth: { username: "alice" },
      },
    )

    await scanCleanWaiter
    await utils.draftModeSave(
      "restriction",
      "DraftIcidents",
      restrictionID,
      "RestrictionService",
    )
  })

  it("should allow DOWNLOAD attachment content for authorized user (alice)", async () => {
    // Now, try to GET the attachment content as alice
    const getRes = await GET(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=true)/attachments(up__ID=${restrictionID},ID=${attachmentID},IsActiveEntity=true)/content`,
      {
        auth: { username: "alice" },
      },
    )
    expect(getRes.status).toEqual(200)
    expect(getRes.data).toBeTruthy()
  })

  it("should reject CREATE attachment for unauthorized user", async () => {
    await POST(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=false)/attachments`,
      {
        up__ID: restrictionID,
        filename: "test.pdf",
        mimeType: "application/pdf",
      },
      { auth: { username: "bob" } },
    ).catch((e) => {
      expect(e.status).toEqual(403)
    })
  })

  it("should reject UPDATE attachment for unauthorized user", async () => {
    // Assume an attachment exists, try to update as bob
    await utils.draftModeEdit(
      "restriction",
      "DraftIcidents",
      restrictionID,
      "RestrictionService",
    )
    await PATCH(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=false)/attachments(up__ID=${restrictionID},ID=${attachmentID},IsActiveEntity=false)`,
      {
        note: "Should fail",
      },
      { auth: { username: "bob" } },
    ).catch((e) => {
      expect(e.status).toEqual(403)
    })
    await utils.draftModeSave(
      "restriction",
      "DraftIcidents",
      restrictionID,
      "RestrictionService",
    )
  })

  it("should reject DOWNLOAD attachment content for unauthorized user", async () => {
    await GET(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=true)/attachments(up__ID=${restrictionID},ID=${attachmentID},IsActiveEntity=true)/content`,
      {
        auth: { username: "bob" },
      },
    ).catch((e) => {
      expect(e.status).toEqual(403)
    })
  })

  it("should reject DELETE attachment for unauthorized user", async () => {
    await DELETE(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=true)/attachments(up__ID=${restrictionID},ID=${attachmentID},IsActiveEntity=true)`,
      {
        auth: { username: "bob" },
      },
    ).catch((e) => {
      expect(e.status).toEqual(403)
    })
  })

  it("should not allow bob to PUT into file alice has POSTed", async () => {
    await utils.draftModeEdit(
      "restriction",
      "DraftIcidents",
      restrictionID,
      "RestrictionService",
    )
    const attachRes = await POST(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=false)/attachments`,
      {
        up__ID: restrictionID,
        filename: "newfile.pdf",
        mimeType: "application/pdf",
      },
      { auth: { username: "alice" } },
    )

    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    await PUT(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=false)/attachments(up__ID=${restrictionID},ID=${attachRes.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
        auth: { username: "bob" },
      },
    ).catch((e) => {
      expect(e.status).toEqual(403)
    })
    await utils.draftModeSave(
      "restriction",
      "DraftIcidents",
      restrictionID,
      "RestrictionService",
    )
  })
})

describe("Tests for renaming duplicate attachments", () => {
  beforeAll(async () => {
    utils = new RequestSend(POST)
  })

  it("should rename duplicate attachments when both are added to same draft", async () => {
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

  it("should rename duplicate attachments when first one has been saved", async () => {
    const incidentID = await newIncident(POST, "processor")

    // Upload first attachment
    await uploadDraftAttachment(utils, POST, GET, incidentID)

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

  it("should rename duplicate attachments when they already end with -1", async () => {
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
    const sharedSampleID = `SHARED-${Math.round(Math.random() * 1000)}`
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

    const newAtt = await await runWithUser(alice, () =>
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
    const newAtt = await await runWithUser(alice, () =>
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
