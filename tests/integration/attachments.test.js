const cds = require("@sap/cds")
const path = require("path")
const { RequestSend } = require("../utils/api")
const { waitForScanStatus, newIncident, waitForMalwareDeletion } = require("../utils/testUtils")
const fs = require("fs")
const { createReadStream } = cds.utils.fs
const { join } = cds.utils.path

const app = path.join(__dirname, "../incidents-app")
const { axios, GET, POST, DELETE, PATCH, PUT } = cds.test(app)
axios.defaults.auth = { username: "alice" }

let utils = null

describe("Tests for uploading/deleting attachments through API calls", () => {
  let log = cds.test.log()
  const isNotLocal = cds.env.requires?.attachments?.kind === 'db' ? it.skip : it
  beforeAll(async () => {
    utils = new RequestSend(POST)
  })

  //Draft mode uploading attachment
  it("Uploading attachment in draft mode with scanning enabled", async () => {
    const incidentID = await newIncident(POST, 'processor')
    let sampleDocID = null
    const scanStartWaiter = waitForScanStatus('Scanning')
    const scanCleanWaiter = waitForScanStatus('Clean')

    const db = await cds.connect.to('db')
    const ScanStates = []
    db.after('*', (res, req) => {
      if (
        req.event === 'UPDATE' && req.query.UPDATE.data.status &&
        req.target.name.includes('.attachments')
      ) {
        ScanStates.push(req.query.UPDATE.data.status)
      }
    })
    // Upload attachment using helper function
    sampleDocID = await uploadDraftAttachment(utils, POST, GET, incidentID)
    expect(sampleDocID).toBeTruthy()

    //read attachments list for Incident
    const attachmentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
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
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
    )
    expect(scanResponse.status).toEqual(200)
    expect(scanResponse.data.value.length).toEqual(1)
    expect(ScanStates.some(s => s === 'Scanning')).toBeTruthy()

    await scanCleanWaiter

    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`
    )
    expect(contentResponse.status).toEqual(200)
    expect(contentResponse.data).toBeTruthy()


    //Check clean status
    const resultResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
    )
    expect(resultResponse.status).toEqual(200)
    expect(ScanStates.some(s => s === 'Clean')).toBeTruthy()
  })

  it("Scan status is translated", async () => {
    const incidentID = await newIncident(POST, 'processor')
    //trigger to upload attachment
    await utils.draftModeEdit("processor", "Incidents", incidentID, "ProcessorService")

    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "test.pdf",
        mimeType: "application/pdf",
        content: createReadStream(join(__dirname, "content/test.pdf")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    )
    await utils.draftModeSave("processor", "Incidents", incidentID, "ProcessorService")

    const scanStatesEN = await cds.run(
      SELECT.from("sap.attachments.ScanStates")
    )
    const scanStatesDE = await cds.run(
      SELECT.localized
        .from("sap.attachments.ScanStates")
        .columns("code", `texts[locale='de'].name as name`)
    )

    // Check Scanning status
    const response = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments?$expand=statusNav($select=name,code)`
    )
    expect(response.status).toEqual(200)
    expect(response.data.value.length).toEqual(1)
    expect(response.data.value[0].statusNav.name).toEqual(
      scanStatesEN.find((state) => state.code === response.data.value[0].status)
        .name
    )

    const responseDE = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments?$expand=statusNav($select=name,code)&sap-locale=de`
    )
    expect(responseDE.status).toEqual(200)
    expect(responseDE.data.value.length).toEqual(1)
    expect(responseDE.data.value[0].statusNav.name).toEqual(
      scanStatesDE.find(
        (state) => state.code === responseDE.data.value[0].status
      ).name
    )
  })

  it("Deleting the attachment", async () => {
    const incidentID = await newIncident(POST, 'processor')
    let sampleDocID = null

    const scanCleanWaiter = waitForScanStatus('Clean')

    // First upload an attachment to delete
    sampleDocID = await uploadDraftAttachment(utils, POST, GET, incidentID)
    expect(sampleDocID).toBeTruthy()

    // Wait for scanning to complete
    await scanCleanWaiter

    //check the content of the uploaded attachment in main table
    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`
    )
    expect(contentResponse.status).toEqual(200)

    const attachmentData = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)`
    )

    //trigger to delete attachment
    await utils.draftModeEdit("processor", "Incidents", incidentID, "ProcessorService")


    const db = await cds.connect.to('db')
    const attachmentIDs = []
    db.before('*', req => {
      if (req.event === 'CREATE' && req.target?.name === 'cds.outbox.Messages') {
        const msg = JSON.parse(req.query.INSERT.entries[0].msg)
        attachmentIDs.push(msg.data.url)
      }
    })

    //delete attachment
    await DELETE(
      `odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=false)`
    )

    await utils.draftModeSave("processor", "Incidents", incidentID, "ProcessorService")

    expect(attachmentIDs[0]).toEqual(attachmentData.data.url)
    expect(attachmentIDs.length).toEqual(1)

    //read attachments list for Incident
    const response = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
    )
    //the data should have no attachments
    expect(response.status).toEqual(200)
    expect(response.data.value.length).toEqual(0)

    await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`
    ).catch(e => {
      expect(e.status).toEqual(404)
      expect(e.response.data.error.message).toMatch(/Not Found/)
    })
  })

  it("Deleting a non existing root does not crash the application", async () => {
    const incidentID = await newIncident(POST, 'processor')
    await utils.draftModeSave("processor", "Incidents", incidentID, "ProcessorService")
    const response = await DELETE(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)`
    )
    expect(response.status).toEqual(204)

    await DELETE(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)`
    ).catch(e => {
      expect(e.status).toEqual(404)
      expect(e.response.data.error.message).toMatch(/Not Found/)
    })
  })

  it("Cancel draft where parent has composed key", async () => {
    const gjahr = Math.round(Math.random() * 1000);
    const sampleID = `ABC ${Math.round(Math.random() * 1000)}`;
    await POST(
      `odata/v4/processor/SampleRootWithComposedEntity`, {
      sampleID: sampleID,
      gjahr: gjahr
    })

    const doc = await POST(
      `odata/v4/processor/SampleRootWithComposedEntity(sampleID='${sampleID}',gjahr=${gjahr},IsActiveEntity=false)/attachments`,
      {
        up__sampleID: sampleID,
        up__gjahr: gjahr,
        filename: 'myfancyfile.pdf',
        content: createReadStream(
          join(__dirname, "..", "integration", "content/sample.pdf")
        ),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    )
    expect(doc.data.ID).toBeTruthy()

    const deleteRes = await DELETE(
      `odata/v4/processor/SampleRootWithComposedEntity(sampleID='${sampleID}',gjahr=${gjahr},IsActiveEntity=false)`
    )
    expect(deleteRes.status).toEqual(204)
  })

  it("On handler for attachments can be overwritten", async () => {
    const gjahr = Math.round(Math.random() * 1000);
    const sampleID = `ABC ${Math.round(Math.random() * 1000)}`;
    await POST(
      `odata/v4/processor/SampleRootWithComposedEntity`, {
      sampleID,
      gjahr
    })

    const doc = await POST(
      `odata/v4/processor/SampleRootWithComposedEntity(sampleID='${sampleID}',gjahr=${gjahr},IsActiveEntity=false)/attachments`,
      {
        up__sampleID: sampleID,
        up__gjahr: gjahr,
        filename: 'myfancyfile.pdf',
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    )
    expect(doc.data.ID).toBeTruthy()

    const fileContent = fs.readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf")
    )
    await PUT(
      `/odata/v4/processor/SampleRootWithComposedEntity_attachments(up__sampleID='${sampleID}',up__gjahr=${gjahr},ID=${doc.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      }
    )
    expect(log.output.length).toBeGreaterThan(0)
    expect(log.output).toContain('overwrite-put-handler')

    const file = await GET(
      `/odata/v4/processor/SampleRootWithComposedEntity_attachments(up__sampleID='${sampleID}',up__gjahr=${gjahr},ID=${doc.data.ID},IsActiveEntity=false)/content`,
    )

    expect(file.status).toEqual(200)
  })

  it("Inserting attachments via srv.run works", async () => {
    const incidentID = await newIncident(POST, 'processor')
    const Catalog = await cds.connect.to('ProcessorService')

    await utils.draftModeEdit("processor", "Incidents", incidentID, "ProcessorService")
    const incident = await SELECT.one.from(Catalog.entities.Incidents.drafts).where({ ID: incidentID })

    const scanCleanWaiter = waitForScanStatus('Clean')

    const fileContent = fs.createReadStream(
      join(__dirname, "..", "integration", "content/sample.pdf")
    )
    const attachmentsID = cds.utils.uuid()
    const user = new cds.User({ id: 'alice', roles: { support: 1 } })
    user._is_privileged = true
    const req = new cds.Request({
      query: INSERT.into(Catalog.entities['Incidents.attachments'].drafts).entries({
        ID: attachmentsID,
        up__ID: incidentID,
        IsActiveEntity: false,
        DraftAdministrativeData_DraftUUID: incident.DraftAdministrativeData_DraftUUID,
        filename: "sample.pdf",
        content: fileContent,
        mimeType: "application/pdf",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }), user: user
    })
    await Catalog.dispatch(req)

    const response = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`
    )
    //the data should have no attachments
    expect(response.status).toEqual(200)
    expect(response.data.value.length).toEqual(1)

    await scanCleanWaiter

    //content should not be there
    const responseContent = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments(up__ID=${incidentID},ID=${attachmentsID},IsActiveEntity=true)/content`
    )
    expect(responseContent.status).toEqual(200)
  })

  it("should fail to upload attachment to non-existent entity", async () => {
    const incidentID = await newIncident(POST, 'admin')
    const fileContent = fs.readFileSync(
      path.join(__dirname, "..", "integration", "content/sample.pdf")
    )
    await PUT(
      `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${cds.utils.uuid()})/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      }
    ).catch(e => {
      expect(e.status).toEqual(404)
      expect(e.response.data.error.message).toMatch(/Not Found/)
    })
  })

  it("should fail to update note for non-existent attachment", async () => {
    const incidentID = await newIncident(POST, 'admin')
    await axios.patch(
      `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${cds.utils.uuid()})`,
      { note: "This should fail" },
      { headers: { "Content-Type": "application/json" } }
    ).catch(e => {
      expect(e.status).toEqual(404)
      expect(e.response.data.error.message).toMatch(/Not Found/)
    })
  })

  it("Malware scanning does not happen when scan is disabled", async () => {
    const incidentID = await newIncident(POST, 'processor')
    cds.env.requires.attachments.scan = false

    let sampleDocID = null
    // Upload attachment using helper function
    sampleDocID = await uploadDraftAttachment(utils, POST, GET, incidentID)
    expect(sampleDocID).toBeTruthy()

    //read attachments list for Incident
    const attachmentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
    )
    //the data should have only one attachment
    expect(attachmentResponse.status).toEqual(200)
    expect(attachmentResponse.data.value.length).toEqual(1)
    //to make sure content is not read
    expect(attachmentResponse.data.value[0].content).toBeFalsy()
    sampleDocID = attachmentResponse.data.value[0].ID

    // Check Scanning status
    const scanResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
    )
    expect(scanResponse.status).toEqual(200)
    expect(scanResponse.data.value.length).toEqual(1)

    const contentResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`
    )
    expect(contentResponse.status).toEqual(200)
    expect(contentResponse.data).toBeTruthy()

    const resultResponse = await GET(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
    )
    expect(resultResponse.status).toEqual(200)


    expect(log.output.length).toBeGreaterThan(0)
    expect(log.output).not.toContain('Initiating malware scan request')
    expect(log.output).toContain('Malware scanner is disabled! Please consider enabling it')

    cds.env.requires.attachments.scan = true
  })

  it("Uploading attachment to Test works and scan status is set", async () => {
    // Create a Test entity
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, {
      ID: testID,
      name: "Test Entity"
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
      }
    )
    expect(res.data.ID).not.toBeNull()

    const fileContent = fs.readFileSync(
      path.join(__dirname, "..", "integration", "content/sample.pdf")
    )
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${res.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        }
      }
    )

    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Test that attachment exists and scan status
    const getRes = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=true)/attachments`
    )
    expect(getRes.status).toEqual(200)
    expect(getRes.data.value.length).toEqual(1)
    expect(["Scanning", "Clean", "Unscanned"]).toContain(getRes.data.value[0].status)
  })

  it("Uploading attachment to nested Test works and scan status is set", async () => {
    // Create a Test entity
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, {
      ID: testID,
      name: "Test Entity",
      attachments: [{
        up__ID: testID,
        filename: "testfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      }]
    })

    const getAtt = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments`
    )

    const fileContent = fs.readFileSync(
      path.join(__dirname, "..", "integration", "content/sample.pdf")
    )
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${getAtt.data.value[0].ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        }
      }
    )

    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Test that attachment exists and scan status
    const getRes = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=true)/attachments`
    )
    expect(getRes.status).toEqual(200)
    expect(getRes.data.value.length).toEqual(1)
    expect(["Scanning", "Clean", "Unscanned"]).toContain(getRes.data.value[0].status)
  })

  it("Creating Test with nested entity and attachments", async () => {
    // Create a Test entity
    const testID = cds.utils.uuid()
    const detailsID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, {
      ID: testID,
      name: "Test Entity",
      attachments: [{
        up__ID: testID,
        filename: "testfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      }],
      details: [{
        ID: detailsID,
        description: "Test Details Entity",
        attachments: [{
          up__ID: detailsID,
          filename: "detailsfile.pdf",
          mimeType: "application/pdf",
          createdAt: new Date(),
          createdBy: "alice",
        }]
      }]
    })

    // Get parent attachment
    const getParentAtt = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments`
    )
    const parentAttID = getParentAtt.data.value[0].ID

    // Get child attachment
    const getChildAtt = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments`
    )
    const childAttID = getChildAtt.data.value[0].ID

    // Upload file content for parent attachment
    const fileContent = fs.readFileSync(
      path.join(__dirname, "..", "integration", "content/sample.pdf")
    )
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${parentAttID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        }
      }
    )

    // Upload file content for child attachment
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments(up__ID=${detailsID},ID=${childAttID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        }
      }
    )

    // Save the draft
    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Test that parent attachment exists and scan status
    const getResParent = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=true)/attachments`
    )
    expect(getResParent.status).toEqual(200)
    expect(getResParent.data.value.length).toEqual(1)
    expect(["Scanning", "Clean", "Unscanned"]).toContain(getResParent.data.value[0].status)

    // Test that child attachment exists and scan status
    const getResChild = await GET(
      `odata/v4/processor/TestDetails(ID=${detailsID},IsActiveEntity=true)/attachments`
    )
    expect(getResChild.status).toEqual(200)
    expect(getResChild.data.value.length).toEqual(1)
    expect(["Scanning", "Clean", "Unscanned"]).toContain(getResChild.data.value[0].status)
  })

  it("Uploading attachment to TestDetails works and scan status is set", async () => {
    // Create a Test entity
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, {
      ID: testID,
      name: "Test Entity"
    })

    // Add TestDetails entity
    const detailsID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details`,
      {
        ID: detailsID,
        description: "Test Details Entity"
      }
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
      }
    )
    expect(res.data.ID).not.toBeNull()

    const fileContent = fs.readFileSync(
      path.join(__dirname, "..", "integration", "content/sample.pdf")
    )
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments(up__ID=${detailsID},ID=${res.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        }
      }
    )

    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Test that attachment exists and scan status
    const getRes = await GET(
      `odata/v4/processor/TestDetails(ID=${detailsID},IsActiveEntity=true)/attachments`
    )
    expect(getRes.status).toEqual(200)
    expect(getRes.data.value.length).toEqual(1)
    expect(["Scanning", "Clean", "Unscanned"]).toContain(getRes.data.value[0].status)
  })

  it("Should reflect all attachment compositions on parent entity", async () => {
    const Catalog = await cds.connect.to('ProcessorService')
    const Test = Catalog.entities.Test
    const TestDetails = Catalog.entities.TestDetails

    // Create a Test entity
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, { ID: testID, name: "Test Entity" })

    // Add a TestDetails entity with attachments
    const detailsID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details`,
      { ID: detailsID, description: "Test Details Entity" }
    )

    // Now check the parent's _attachments properties
    expect(Test._attachments.hasAttachmentsComposition).toBe(true)
    expect(Object.keys(Test._attachments.attachmentCompositions).length).toBe(2)
    expect(TestDetails._attachments.hasAttachmentsComposition).toBe(true)
    expect(Object.keys(TestDetails._attachments.attachmentCompositions).length).toBe(1)
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
      }
    )
    expect(attachRes.data.ID).not.toBeNull()
    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")
    // Delete the parent Test entity
    const delRes = await DELETE(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=true)`
    )
    expect(delRes.status).toEqual(204)

    // Check that the attachment is deleted
    let error
    try {
      await GET(
        `odata/v4/processor/Test_attachments(up__ID=${testID},ID=${attachRes.data.ID},IsActiveEntity=true)`
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
      { ID: detailsID, description: "Test Details Entity" }
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
      }
    )
    expect(attachRes.data.ID).not.toBeNull()
    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Delete the child TestDetails entity
    const delRes = await DELETE(
      `odata/v4/processor/TestDetails(ID=${detailsID},IsActiveEntity=true)`
    )
    expect(delRes.status).toEqual(204)

    // Check that the attachment is deleted
    let error
    try {
      await GET(
        `odata/v4/processor/TestDetails_attachments(up__ID=${detailsID},ID=${attachRes.data.ID},IsActiveEntity=true)`
      )
    } catch (e) {
      error = e
    }
    expect(error?.response?.status || error?.status).toEqual(404)
  })

  it("Deleting Test deletes both Test and TestDetails attachments", async () => {
    const scanCleanWaiter = waitForScanStatus('Clean')
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
      }
    )
    expect(attachResTest.data.ID).not.toBeNull()

    const fileContent = fs.readFileSync(
      path.join(__dirname, "..", "integration", "content/sample.pdf")
    )
    await PUT(
      `/odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${attachResTest.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        }
      }
    )

    const detailsID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details`,
      { ID: detailsID, description: "Test Details Entity" }
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
      }
    )
    expect(attachResDetails.data.ID).not.toBeNull()
    await scanCleanWaiter
    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Delete the child TestDetails entity
    const delRes = await DELETE(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=true)`
    )
    expect(delRes.status).toEqual(204)

    // Check that the attachment is deleted
    let error
    try {
      await GET(
        `odata/v4/processor/Test_attachments(up__ID=${testID},ID=${attachResTest.data.ID},IsActiveEntity=true)`
      )
    } catch (e) {
      error = e
    }
    expect(error?.response?.status || error?.status).toEqual(404)
    error = null

    try {
      await GET(
        `odata/v4/processor/TestDetails_attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID},IsActiveEntity=true)`
      )
    } catch (e) {
      error = e
    }
    expect(error?.response?.status || error?.status).toEqual(404)
  })

  it("Canceling a draft removes all unsaved added attachments from parent and child entities", async () => {
    // Create parent entity in draft mode
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, { ID: testID, name: "Draft Cancel Test" })

    // Add attachment to parent
    const attachResParent = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments`,
      {
        up__ID: testID,
        filename: "parentfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      }
    )
    expect(attachResParent.data.ID).toBeTruthy()

    // Add child entity and attachment
    const detailsID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details`,
      { ID: detailsID, description: "Draft Cancel Child" }
    )
    const attachResChild = await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments`,
      {
        up__ID: detailsID,
        filename: "childfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      }
    )
    expect(attachResChild.data.ID).toBeTruthy()

    // Cancel the draft
    const cancelRes = await DELETE(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)`
    )
    expect(cancelRes.status).toEqual(204)

    // Check that parent attachment is deleted
    let error
    try {
      await GET(
        `odata/v4/processor/Test_attachments(up__ID=${testID},ID=${attachResParent.data.ID},IsActiveEntity=true)`
      )
    } catch (e) {
      error = e
    }
    expect(error?.response?.status || error?.status).toEqual(404)
    error = null

    // Check that child attachment is deleted
    try {
      await GET(
        `odata/v4/processor/TestDetails_attachments(up__ID=${detailsID},ID=${attachResChild.data.ID},IsActiveEntity=true)`
      )
    } catch (e) {
      error = e
    }
    expect(error?.response?.status || error?.status).toEqual(404)
  })

  it("Canceling a draft does not remove any unsaved deleted attachments from parent and child entities", async () => {
    // Create parent entity in draft mode
    const testID = cds.utils.uuid()
    await POST(`odata/v4/processor/Test`, { ID: testID, name: "Draft Cancel Test" })

    // Add child entity and attachment
    const detailsID = cds.utils.uuid()
    await POST(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details`,
      { ID: detailsID, description: "Draft Cancel Child" }
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
      }
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
      }
    )
    expect(attachResChild.data.ID).toBeTruthy()

    // Save the draft
    await utils.draftModeSave("processor", "Test", testID, "ProcessorService")

    // Start editing again (create a new draft)
    await utils.draftModeEdit("processor", "Test", testID, "ProcessorService")

    // Delete attachments in the draft
    await DELETE(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${attachResParent.data.ID},IsActiveEntity=false)`
    )
    await DELETE(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/details(ID=${detailsID},IsActiveEntity=false)/attachments(up__ID=${detailsID},ID=${attachResChild.data.ID},IsActiveEntity=false)`
    )

    // Discard the draft (do NOT save)
    const discardRes = await DELETE(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)`
    )
    expect(discardRes.status).toEqual(204)

    // Check that parent attachment is still present
    const parentAttachment = await GET(
      `odata/v4/processor/Test_attachments(up__ID=${testID},ID=${attachResParent.data.ID},IsActiveEntity=true)`
    )
    expect(parentAttachment.status).toEqual(200)
    expect(parentAttachment.data.ID).toEqual(attachResParent.data.ID)
    expect(parentAttachment.data.filename).toBe("parentfile.pdf")

    // Check that child attachment is still present
    const childAttachment = await GET(
      `odata/v4/processor/TestDetails_attachments(up__ID=${detailsID},ID=${attachResChild.data.ID},IsActiveEntity=true)`
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
      }
    )
    expect(res.data.ID).toBeTruthy()

    const getRes = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${res.data.ID},IsActiveEntity=false)`
    )
    expect(getRes.status).toBe(200)
    expect(getRes.data.url).not.toBe(maliciousUrl)
    expect(getRes.data.url).toBeTruthy()

    // Try to PATCH the url
    const newMaliciousUrl = "malicious-patch-key"
    await PATCH(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${res.data.ID},IsActiveEntity=false)`,
      { url: newMaliciousUrl }
    )

    const getRes2 = await GET(
      `odata/v4/processor/Test(ID=${testID},IsActiveEntity=false)/attachments(up__ID=${testID},ID=${res.data.ID},IsActiveEntity=false)`
    )
    expect(getRes2.status).toBe(200)
    expect(getRes2.data.url).not.toBe(newMaliciousUrl)
    expect(getRes2.data.url).not.toBe(maliciousUrl)
    expect(getRes2.data.url).toBeTruthy()
  })

  isNotLocal("Should detect infected files and automatically delete them after scan", async () => {
    const incidentID = await newIncident(POST, 'processor')
    const testMal = "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=";
    const fileContent = Buffer.from(testMal, 'base64').toString("utf8")

    const scanInfectedWaiter = waitForScanStatus("Infected")

    await utils.draftModeEdit("processor", "Incidents", incidentID, "ProcessorService")
    const res = await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "testmal.png",
        mimeType: "image/png",
        createdAt: new Date(),
        createdBy: "alice",
      }
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
      }
    )

    await utils.draftModeSave("processor", "Incidents", incidentID, "ProcessorService")

    // Check that status is "infected" after scan
    await scanInfectedWaiter

    // Wait for deletion to complete
    await deletionWaiter
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
    expect(res.data.ProcessorService.$Annotations['ProcessorService.Incidents_attachments/up__ID']?.['@UI.Hidden']).toEqual(true)
    expect(res.data.ProcessorService.$Annotations['ProcessorService.Incidents_attachments/up_']?.['@UI.Hidden']).toEqual(true)
  })

  it("Checking attachments facet metadata when @UI.Hidden is undefined", async () => {
    const res = await GET(`odata/v4/processor/$metadata?$format=json`)
    expect(res.status).toEqual(200)
    const facets =
      res.data.ProcessorService.$Annotations["ProcessorService.Incidents"][
      "@UI.Facets"
      ]
    const attachmentsFacetLabel = facets.some(
      (facet) => facet.Label === "Attachments"
    )
    const attachmentsFacetTarget = facets.some(
      (facet) => facet.Target === "attachments/@UI.LineItem"
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
      (facet) => facet.Label === "Attachments"
    )

    //Checking the facet metadata for hiddenAttachments since its annotated with @attachments.disable_facet as enabled
    const hiddenAttachmentsFacetTarget = facets.some(
      (facet) => facet.Target === "hiddenAttachments/@UI.LineItem"
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
      (facet) => facet.Label === "Attachments"
    )

    const hiddenAttachmentsFacetTarget = facets.find(
      (facet) => facet.Target === "hiddenAttachments2/@UI.LineItem"
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
      (facet) => facet.Target === "attachments/@UI.LineItem"
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
    const incidentID = await newIncident(POST, 'processor')
    await utils.draftModeEdit("processor", "Incidents", incidentID, "ProcessorService")

    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/mediaTypeAttachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/pdf",
        content: createReadStream(join(__dirname, "content/sample.pdf")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    ).catch(e => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.message).toMatch(/AttachmentMimeTypeDisallowed/)
    })
  })

  it("Uploading attachment with disallowed mime type and boundary specified", async () => {
    const incidentID = await newIncident(POST, 'processor')
    await utils.draftModeEdit("processor", "Incidents", incidentID, "ProcessorService")

    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/mediaTypeAttachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg boundary=something",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    ).catch(e => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.message).toMatch(/AttachmentMimeTypeDisallowed/)
    })
  })

  it("Uploading attachment with disallowed mime type and charset specified", async () => {
    const incidentID = await newIncident(POST, 'processor')
    await utils.draftModeEdit("processor", "Incidents", incidentID, "ProcessorService")

    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/mediaTypeAttachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    ).catch(e => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.message).toMatch(/AttachmentMimeTypeDisallowed/)
    })
  })
})

describe('Testing max and min amounts of attachments', () => {
  beforeAll(async () => {
    utils = new RequestSend(POST)
  })

  it('Create of record in draft gives warning when maximum is met', async () => {
    const incidentID = await newIncident(POST, 'validation-test')

    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    )
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    )
    const { status: postStatus } = await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    )
    expect(postStatus).toEqual(201)

    const { response } = await utils.draftModeSave("validation-test", "Incidents", incidentID, "ValidationTestService")
    expect(response.status).toEqual(400)
    expect(response.data.error.code).toEqual('MaximumAmountExceeded')
    expect(response.data.error.target).toEqual('attachments')
  })

  it('Delete of record in draft gives warning when minimum is not met', async () => {
    const incidentID = await newIncident(POST, 'validation-test')

    const { data: newAttachment } = await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    )
    const { status: deleteStatus } = await DELETE(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments(up__ID=${incidentID},ID=${newAttachment.ID},IsActiveEntity=false)`
    )

    expect(deleteStatus).toEqual(204)

    const { response } = await utils.draftModeSave("validation-test", "Incidents", incidentID, "ValidationTestService")
    expect(response.status).toEqual(400)
    expect(response.data.error.code).toEqual('MinimumAmountNotFulfilled')
    expect(response.data.error.target).toEqual('attachments')
  })

  it('Deep create of new draft gives warning when minimum is not met or maximum exceeded', async () => {
    const incidentID = await newIncident(POST, 'validation-test')

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
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
            ),
            createdBy: "alice",
          }
        ]
      }
    )
    expect(status).toEqual(201)

    const { status: minStatus } = await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation`,
      {
        up__ID: incidentID,
        ID: cds.utils.uuid(),
        message: "ABC",
        attachments: []
      }
    );
    expect(minStatus).toEqual(201)

    const { response: resMin } = await utils.draftModeSave("validation-test", "Incidents", incidentID, "ValidationTestService")
    expect(resMin.status).toEqual(400)
    const errMin = resMin.data.error.details.find(e => e.target.startsWith('conversation'))
    expect(errMin.code).toEqual('MinimumAmountNotFulfilled|ValidationTestService.Incidents.conversation')

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
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
            ),
            createdBy: "alice",
          },
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
            ),
            createdBy: "alice",
          },
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
            ),
            createdBy: "alice",
          }
        ]
      }
    )
    expect(postStatus).toEqual(201)

    const { response } = await utils.draftModeSave("validation-test", "Incidents", incidentID, "ValidationTestService")
    expect(response.status).toEqual(400)
    const err = response.data.error.details.find(e => e.target.startsWith('conversation') && e.code === 'MaximumAmountExceeded')
    expect(err.code).toEqual('MaximumAmountExceeded')
  })

  it('Deep update of draft gives warning when minimum is not met or maximum exceeded', async () => {
    const incidentID = await newIncident(POST, 'validation-test')

    const conversationID = cds.utils.uuid();
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation`,
      {
        ID: conversationID,
        message: "ABC",
      }
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
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
            ),
            createdBy: "alice",
            DraftAdministrativeData_DraftUUID: '12345'
          }
        ]
      }
    )
    expect(status).toEqual(200)

    await PATCH(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation(ID=${conversationID},IsActiveEntity=false)`,
      {
        message: "ABC",
        attachments: []
      }
    ).catch(e => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.code).toMatch('MinimumAmountNotFulfilled|ValidationTestService.Incidents.conversation')
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
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
            ),
            createdBy: "alice",
            DraftAdministrativeData_DraftUUID: '12345'
          },
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
            ),
            createdBy: "alice",
            DraftAdministrativeData_DraftUUID: '12345'
          },
          {
            filename: "sample.pdf",
            mimeType: "application/jpeg; charset=UTF-8",
            createdAt: new Date(
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
            ),
            createdBy: "alice",
            DraftAdministrativeData_DraftUUID: '12345'
          }
        ]
      }
    ).catch(e => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.code).toMatch('MaximumAmountExceeded')
    })
  })

  it('On SAVE error is thrown when minimum is not met', async () => {
    const incidentID = await newIncident(POST, 'validation-test')
    const { response } = await utils.draftModeSave("validation-test", "Incidents", incidentID, "ValidationTestService")
    expect(response.status).toEqual(400)
    expect(response.data.error.code).toEqual('MinimumAmountNotFulfilled')
  })

  it('On SAVE error is thrown when maximum is exceeded', async () => {
    const incidentID = await newIncident(POST, 'validation-test')
    const { data: { ID: conversationID } } = await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation`,
      {
        message: "DEF",
      }
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
              Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
            ),
            createdBy: "alice",
            DraftAdministrativeData_DraftUUID: '12345'
          }
        ]
      }
    )
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    )
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    )
    await INSERT.into(cds.model.definitions['ValidationTestService.Incidents.attachments'].drafts).entries(
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
        DraftAdministrativeData_DraftUUID: '1234',
        IsActiveEntity: false
      }
    )
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/hiddenAttachments2`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    )

    const { response } = await utils.draftModeSave("validation-test", "Incidents", incidentID, "ValidationTestService")
    expect(response.status).toEqual(400)
    expect(response.data.error.code).toEqual('MaximumAmountExceeded')
  })

  it('On SAVE errors are thrown for nested attachments', async () => {
    const incidentID = await newIncident(POST, 'validation-test')
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation`,
      {
        up__ID: incidentID,
        ID: cds.utils.uuid(),
        message: "ABC",
        attachments: []
      }
    )
    const { response } = await utils.draftModeSave("validation-test", "Incidents", incidentID, "ValidationTestService")
    expect(response.status).toEqual(400)
    const errors = response.data.error.details.filter(e => e.target.startsWith('conversation'))
    expect(errors.length).toEqual(1)
    for (const error of errors) {
      expect(error.code).toEqual('MinimumAmountNotFulfilled|ValidationTestService.Incidents.conversation')
    }
  })

  it('custom error message can be specified targeting composition property', async () => {
    const incidentID = await newIncident(POST, 'validation-test')
    await POST(
      `odata/v4/validation-test/Incidents(ID=${incidentID},IsActiveEntity=false)/conversation`,
      {
        up__ID: incidentID,
        ID: cds.utils.uuid(),
        message: "ABC",
        attachments: []
      }
    )
    const { response } = await utils.draftModeSave("validation-test", "Incidents", incidentID, "ValidationTestService")
    expect(response.status).toEqual(400)
    const err = response.data.error.details.find(e => e.target.startsWith('conversation'));
    expect(err.code).toEqual('MinimumAmountNotFulfilled|ValidationTestService.Incidents.conversation')
  })

  it('custom error message can be specified for entity', async () => {
    const highIncID = await newIncident(POST, 'validation-test', {
      title: `Incident ${Math.floor(Math.random() * 1000)}`,
      customer_ID: '1004155',
      urgency_code: 'H'
    })
    const { response } = await utils.draftModeSave("validation-test", "Incidents", highIncID, "ValidationTestService")
    expect(response.status).toEqual(400)
    const err = response.data.error.details.find(e => e.target.startsWith('hiddenAttachments2'));
    expect(err.code).toEqual('MinimumAmountNotFulfilled|ValidationTestService.Incidents|hiddenAttachments2')
  })

  it('On SAVE dynamic min/max is possible', async () => {
    const highIncID = await newIncident(POST, 'validation-test', {
      title: `Incident ${Math.floor(Math.random() * 1000)}`,
      customer_ID: '1004155',
      urgency_code: 'H'
    })
    // First with urgency_code = M - save, to few and to max
    await INSERT.into(cds.model.definitions['ValidationTestService.Incidents.hiddenAttachments'].drafts).entries(
      {
        up__ID: highIncID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
        DraftAdministrativeData_DraftUUID: '1234',
        IsActiveEntity: false
      },
      {
        up__ID: highIncID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
        DraftAdministrativeData_DraftUUID: '1234',
        IsActiveEntity: false
      },
      {
        up__ID: highIncID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
        DraftAdministrativeData_DraftUUID: '1234',
        IsActiveEntity: false
      }
    )

    const { response: res1 } = await utils.draftModeSave("validation-test", "Incidents", highIncID, "ValidationTestService")
    expect(res1.status).toEqual(400)
    const errMax1 = res1.data.error.details.find(e => e.target.startsWith('hiddenAttachments'));
    expect(errMax1.code).toEqual('MaximumAmountExceeded')

    const errMin1 = res1.data.error.details.find(e => e.target.startsWith('hiddenAttachments2'));
    expect(errMin1.code).toEqual('MinimumAmountNotFulfilled|ValidationTestService.Incidents|hiddenAttachments2')

    await PATCH(`odata/v4/validation-test/Incidents(ID=${highIncID},IsActiveEntity=false)`, {
      urgency_code: 'M'
    })

    await POST(
      `odata/v4/validation-test/Incidents(ID=${highIncID},IsActiveEntity=false)/attachments`,
      {
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        content: createReadStream(join(__dirname, "content/sample-1.jpg")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    )

    const { status } = await utils.draftModeSave("validation-test", "Incidents", highIncID, "ValidationTestService")
    expect(status).toEqual(201)
  })
})

describe("Row-level security on attachments composition", () => {
  let restrictionID, attachmentID

  beforeAll(async () => {
    utils = new RequestSend(POST)
    const scanCleanWaiter = waitForScanStatus('Clean')
    // Create a Incidents entity as a Manager
    restrictionID = cds.utils.uuid()
    await POST("/odata/v4/restriction/DraftIcidents", {
      ID: restrictionID,
      title: "ABC"
    }, { auth: { username: "alice" } })

    // Create an attachment as alice and save the ID
    const attachRes = await POST(`/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=false)/attachments`, {
      up__ID: restrictionID,
      filename: "test.pdf",
      mimeType: "application/pdf"
    }, { auth: { username: "alice" } })
    attachmentID = attachRes.data.ID

    const fileContent = fs.readFileSync(
      path.join(__dirname, "..", "integration", "content/sample.pdf")
    )
    await PUT(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=false)/attachments(up__ID=${restrictionID},ID=${attachmentID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
        auth: { username: "alice" }
      }
    )

    await scanCleanWaiter
    await utils.draftModeSave("restriction", "DraftIcidents", restrictionID, "RestrictionService")
  })

  it("should allow DOWNLOAD attachment content for authorized user (alice)", async () => {
    // Now, try to GET the attachment content as alice
    const getRes = await GET(`/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=true)/attachments(up__ID=${restrictionID},ID=${attachmentID},IsActiveEntity=true)/content`, {
      auth: { username: "alice" }
    })
    expect(getRes.status).toEqual(200)
    expect(getRes.data).toBeTruthy()
  })

  it("should reject CREATE attachment for unauthorized user", async () => {
    await POST(`/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=false)/attachments`, {
      up__ID: restrictionID,
      filename: "test.pdf",
      mimeType: "application/pdf"
    }, { auth: { username: "bob" } }).catch(e => {
      expect(e.status).toEqual(403)
    })
  })

  it("should reject UPDATE attachment for unauthorized user", async () => {
    // Assume an attachment exists, try to update as bob
    await utils.draftModeEdit("restriction", "DraftIcidents", restrictionID, "RestrictionService")
    await axios.patch(`/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=false)/attachments(up__ID=${restrictionID},ID=${attachmentID},IsActiveEntity=false)`, {
      note: "Should fail"
    }, { auth: { username: "bob" } }).catch(e => {
      expect(e.status).toEqual(403)
    })
    await utils.draftModeSave("restriction", "DraftIcidents", restrictionID, "RestrictionService")
  })

  it("should reject DOWNLOAD attachment content for unauthorized user", async () => {
    await GET(`/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=true)/attachments(up__ID=${restrictionID},ID=${attachmentID},IsActiveEntity=true)/content`, {
      auth: { username: "bob" }
    }).catch(e => {
      expect(e.status).toEqual(403)
    })
  })

  it("should reject DELETE attachment for unauthorized user", async () => {
    await DELETE(`/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=true)/attachments(up__ID=${restrictionID},ID=${attachmentID},IsActiveEntity=true)`, {
      auth: { username: "bob" }
    }).catch(e => {
      expect(e.status).toEqual(403)
    })
  })

  it("should not allow bob to PUT into file alice has POSTed", async () => {
    await utils.draftModeEdit("restriction", "DraftIcidents", restrictionID, "RestrictionService")
    const attachRes = await POST(`/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=false)/attachments`, {
      up__ID: restrictionID,
      filename: "newfile.pdf",
      mimeType: "application/pdf"
    }, { auth: { username: "alice" } })

    const fileContent = fs.readFileSync(
      path.join(__dirname, "..", "integration", "content/sample.pdf")
    )
    await PUT(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=false)/attachments(up__ID=${restrictionID},ID=${attachRes.data.ID},IsActiveEntity=false)/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
        auth: { username: "bob" }
      }
    ).catch(e => {
      expect(e.status).toEqual(403)
    })
    await utils.draftModeSave("restriction", "DraftIcidents", restrictionID, "RestrictionService")
  })
})

/**
 * Uploads attachment in draft mode using CDS test utilities
 * @param {Object} utils - RequestSend utility instance
 * @param {Object} POST - CDS test POST function
 * @param {Object} GET - CDS test GET function
 * @param {string} incidentId - Incident ID
 * @param {string} filename - Filename for the attachment
 * @returns {Promise<string>} - Attachment ID
 */
async function uploadDraftAttachment(
  utils,
  POST,
  GET,
  incidentId,
  filename = "sample.pdf",
  entityName = 'attachments'
) {
  await utils.draftModeEdit("processor", "Incidents", incidentId, "ProcessorService")

  const res = await POST(
    `odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=false)/${entityName}`,
    {
      up__ID: incidentId,
      filename: filename,
      mimeType: "application/pdf",
      createdAt: new Date(
        Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
      ),
      createdBy: "alice",
    }
  )
  const fileContent = fs.readFileSync(
    join(__dirname, "..", "integration", "content/sample.pdf")
  )
  await PUT(
    `/odata/v4/processor/Incidents_${entityName}(up__ID=${incidentId},ID=${res.data.ID},IsActiveEntity=false)/content`,
    fileContent,
    {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": fileContent.length,
      },
    }
  )

  await utils.draftModeSave("processor", "Incidents", incidentId, "ProcessorService")

  // Get the uploaded attachment ID
  const response = await GET(
    `odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=true)/${entityName}`
  )
  return response.data.value[0]?.ID
}
