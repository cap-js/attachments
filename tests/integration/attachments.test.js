const cds = require("@sap/cds")
const path = require("path")
const { RequestSend } = require("../utils/api")
const { waitForScanStatus } = require("../utils/testUtils")
const fs = require("fs")
const { createReadStream } = cds.utils.fs
const { join } = cds.utils.path

const app = path.join(__dirname, "../incidents-app")
const { test, axios, GET, POST, DELETE } = cds.test(app)
axios.defaults.auth = { username: "alice" }

let utils = null
const incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418"

describe("Tests for uploading/deleting attachments through API calls", () => {
  beforeAll(async () => {
    utils = new RequestSend(POST)
  })

  beforeEach(async () => {
    await test.data.reset()
  })

  //Draft mode uploading attachment
  it("Uploading attachment in draft mode with scanning enabled", async () => {
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
    //trigger to upload attachment
    await utils.draftModeEdit("processor", "Incidents", incidentID, "ProcessorService")

    await POST(
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
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

  //Deleting the attachment
  it("Deleting the attachment", async () => {
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
    await POST(
      `odata/v4/processor/SampleRootWithComposedEntity`, {
      sampleID: "ABC",
      gjahr: 2025
    })

    const doc = await POST(
      `odata/v4/processor/SampleRootWithComposedEntity(sampleID='ABC',gjahr=2025,IsActiveEntity=false)/attachments`,
      {
        up__sampleID: 'ABC',
        up__gjahr: 2025,
        filename: 'myfancyfile',
        mimeType: "application/pdf",
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
      `odata/v4/processor/SampleRootWithComposedEntity(sampleID='ABC',gjahr=2025,IsActiveEntity=false)`
    )
    expect(deleteRes.status).toEqual(204)
  })

  it("Inserting attachments via srv.run works", async () => {
    const Catalog = await cds.connect.to('ProcessorService')

    await utils.draftModeEdit("processor", "Incidents", incidentID, "ProcessorService")
    const incident = await SELECT.one.from(Catalog.entities.Incidents.drafts).where({ ID: incidentID })

    const scanCleanWaiter = waitForScanStatus('Clean')

    const fileContent = fs.createReadStream(
      join(__dirname, "..", "integration", "content/sample.pdf")
    )
    const attachmentsID = cds.utils.uuid();
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
    const fileContent = fs.readFileSync(
      path.join(__dirname, "..", "integration", "content/sample.pdf")
    )
    await axios.put(
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
    await axios.patch(
      `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${cds.utils.uuid()})`,
      { note: "This should fail" },
      { headers: { "Content-Type": "application/json" } }
    ).catch(e => {
      expect(e.status).toEqual(404)
      expect(e.response.data.error.message).toMatch(/Not Found/)
    })
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
  filename = "sample.pdf"
) {
  await utils.draftModeEdit("processor", "Incidents", incidentID, "ProcessorService")

  const res = await POST(
    `odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=false)/attachments`,
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
  await axios.put(
    `/odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${res.data.ID},IsActiveEntity=false)/content`,
    fileContent,
    {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": fileContent.length,
      },
    }
  )

  await utils.draftModeSave("processor", "Incidents", incidentID, "ProcessorService")

  // Get the uploaded attachment ID
  const response = await GET(
    `odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=true)/attachments`
  )
  return response.data.value[0]?.ID
}
