const path = require("path")
const fs = require("fs")
const cds = require("@sap/cds")
const { test } = cds.test()
const { waitForScanStatus, delay } = require("../utils/testUtils")

const app = path.resolve(__dirname, "../incidents-app")
const { expect, axios } = require("@cap-js/cds-test")(app)

let incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418"

describe("Tests for uploading/deleting and fetching attachments through API calls with non draft mode", () => {
  axios.defaults.auth = { username: "alice" }
  let log = test.log()
  const { createAttachmentMetadata, uploadAttachmentContent } =
    createHelpers(axios)

  beforeEach(async () => {
    // Clean up any existing attachments before each test
    await test.data.reset()
  })

  it("Create new entity and ensuring nothing attachment related crashes", async () => {
    const resCreate = await axios.post('/odata/v4/admin/Incidents', {
      title: 'New Incident'
    })
    expect(resCreate.status).to.equal(201)
    expect(resCreate.data.title).to.equal('New Incident')
  })

  it("should create attachment metadata", async () => {
    const attachmentID = await createAttachmentMetadata(incidentID)
    expect(attachmentID).to.exist
  })

  it("should create attachment metadata", async () => {
    const attachmentID = await createAttachmentMetadata(incidentID)
    expect(attachmentID).to.exist
  })

  it("should upload attachment content", async () => {
    const attachmentID = await createAttachmentMetadata(incidentID)
    const response = await uploadAttachmentContent(incidentID, attachmentID)
    expect(response.status).to.equal(204)
  })

  it("unknown extension throws warning", async () => {
    const response = await axios.post(
      `/odata/v4/admin/Incidents(${incidentID})/attachments`,
      { filename: 'sample.madeupextension' },
      { headers: { "Content-Type": "application/json" } }
    )
    expect(response.status).to.equal(201);
    expect(log.output.length).to.be.greaterThan(0)
    expect(log.output).to.contain('is uploaded whose extension "madeupextension" is not known! Falling back to "application/octet-stream"')
  })

  it("should list attachments for incident", async () => {

    const attachmentID = await createAttachmentMetadata(incidentID)
    const scanCleanWaiter = waitForScanStatus('Clean', attachmentID)
    await uploadAttachmentContent(incidentID, attachmentID)

    // Wait for scanning to complete
    await scanCleanWaiter

    const response = await axios.get(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments`
    )
    expect(response.status).to.equal(200)

    const attachment = response.data.value[0]

    expect(attachment.up__ID).to.equal(incidentID)
    expect(attachment.filename).to.equal("sample.pdf")
    expect(attachment.status).to.equal("Clean")
    expect(attachment.content).to.be.undefined
    expect(response.data.value[0].ID).to.equal(attachmentID)
  })

  it("Fetching the content of the uploaded attachment", async () => {

    const attachmentID = await createAttachmentMetadata(incidentID)
    const scanCleanWaiter = waitForScanStatus('Clean', attachmentID)
    await uploadAttachmentContent(incidentID, attachmentID)

    // Wait for scanning to complete
    await scanCleanWaiter

    const response = await axios.get(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`,
      { responseType: "arraybuffer" }
    )
    expect(response.status).to.equal(200)
    expect(response.data).to.exist
    expect(response.data.length).to.be.greaterThan(0)

    const originalContent = fs.readFileSync(
      path.join(__dirname, "content/sample.pdf")
    )
    expect(Buffer.compare(response.data, originalContent)).to.equal(0)
  })

  it("should delete attachment and verify deletion", async () => {

    const attachmentID = await createAttachmentMetadata(incidentID)
    const scanCleanWaiter = waitForScanStatus('Clean', attachmentID)
    await uploadAttachmentContent(incidentID, attachmentID)

    // Wait for scanning to complete
    await scanCleanWaiter

    // Delete the attachment
    const deleteResponse = await axios.delete(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
    )
    expect(deleteResponse.status).to.equal(204)

    // Verify the attachment is deleted
    await axios.get(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
    ).catch(e => {
      expect(e.status).to.equal(404)
    })
  })

  it("Updating attachments via srv.run works", async () => {
    const AdminSrv = await cds.connect.to('AdminService')

    const attachmentsID = cds.utils.uuid();
    const doc = await axios.post(
      `odata/v4/admin/Incidents(ID=${incidentID})/attachments`,
      {
        ID: attachmentsID,
        up__ID: incidentID,
      }
    )

    const scanCleanWaiter = waitForScanStatus('Clean')

    const fileContent = fs.createReadStream(
      path.join(__dirname, "content/sample.pdf")
    )
    const contentLength = fs.statSync(
      path.join(__dirname, "content/sample.pdf")
    ).size

    const user = new cds.User({ id: 'alice', roles: { admin: 1 } })
    const req = new cds.Request({
      query: UPDATE.entity({ ref: [{ id: 'AdminService.Incidents', where: [{ ref: ['ID'] }, '=', { val: incidentID }] }, { id: 'attachments', where: [{ ref: ['ID'] }, '=', { val: doc.data.ID }] }] }).set({
        filename: "test.pdf",
        content: fileContent,
        mimeType: "application/pdf",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }), user: user, headers: { "content-length": contentLength }
    })
    const ctx = cds.EventContext.for({ id: cds.utils.uuid(), http: { req: null, res: null } })
    ctx.user = user
    await cds._with(ctx, () => AdminSrv.dispatch(req))

    const response = await axios.get(
      `odata/v4/admin/Incidents(ID=${incidentID})/attachments`
    )
    //the data should have no attachments
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(1)

    await scanCleanWaiter

    //content should not be there
    const responseContent = await axios.get(
      `odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentsID})/content`
    )
    expect(responseContent.status).to.equal(200)
  })

  it("should add and fetch attachments for both NonDraftTest and SingleTestDetails in non-draft mode", async () => {
    const testID = cds.utils.uuid()
    const detailsID = cds.utils.uuid()
    await axios.post(`odata/v4/processor/NonDraftTest`, {
      ID: testID,
      name: "Non-draft Test",
      singledetails: { ID: detailsID, abc: "child" }
    })

    const attachResTest = await axios.post(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments`,
      {
        up__ID: testID,
        filename: "parentfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
      { headers: { "Content-Type": "application/json" } }
    )
    expect(attachResTest.data.ID).to.be.ok

    const attachResDetails = await axios.post(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments`,
      {
        up__ID: detailsID,
        filename: "childfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      }
    )
    expect(attachResDetails.data.ID).to.be.ok

    const parentAttachment = await axios.get(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`
    )

    expect(parentAttachment.status).to.equal(200)
    expect(parentAttachment.data.ID).to.equal(attachResTest.data.ID)
    expect(parentAttachment.data.filename).to.equal("parentfile.pdf")

    const childAttachment = await axios.get(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`
    )
    expect(childAttachment.status).to.equal(200)
    expect(childAttachment.data.ID).to.equal(attachResDetails.data.ID)
    expect(childAttachment.data.filename).to.equal("childfile.pdf")
  })

  it("should delete attachments for both NonDraftTest and SingleTestDetails in non-draft mode", async () => {
    const testID = cds.utils.uuid()
    const detailsID = cds.utils.uuid()
    await axios.post(`odata/v4/processor/NonDraftTest`, {
      ID: testID,
      name: "Non-draft Test",
      singledetails: { ID: detailsID, abc: "child" }
    })

    const attachResTest = await axios.post(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments`,
      {
        up__ID: testID,
        filename: "parentfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
      { headers: { "Content-Type": "application/json" } }
    )
    expect(attachResTest.data.ID).to.be.ok

    const attachResDetails = await axios.post(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments`,
      {
        up__ID: detailsID,
        filename: "childfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      }
    )
    expect(attachResDetails.data.ID).to.be.ok

    // Delete parent attachment
    const delParent = await axios.delete(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`
    )
    expect(delParent.status).to.equal(204)

    // Delete child attachment
    const delChild = await axios.delete(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`
    )
    expect(delChild.status).to.equal(204)

    // Confirm parent attachment is deleted
    await axios.get(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`
    ).catch(e => {
      expect(e.response.status).to.equal(404)
    })

    // Confirm child attachment is deleted
    await axios.get(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`
    ).catch(e => {
      expect(e.response.status).to.equal(404)
    })
  })

  it("should delete attachments for both NonDraftTest and SingleTestDetails when entities are deleted in non-draft mode", async () => {
    const testID = cds.utils.uuid()
    const detailsID = cds.utils.uuid()

    const attachmentsSrv = await cds.connect.to('attachments')
    const deleteSpy = jest.spyOn(attachmentsSrv, 'delete')

    await axios.post(`odata/v4/processor/NonDraftTest`, {
      ID: testID,
      name: "Non-draft Test",
      singledetails: { ID: detailsID, abc: "child" }
    })

    const attachResTest = await axios.post(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments`,
      {
        up__ID: testID,
        filename: "parentfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
      { headers: { "Content-Type": "application/json" } }
    )
    expect(attachResTest.data.ID).to.be.ok

    const attachResDetails = await axios.post(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments`,
      {
        up__ID: detailsID,
        filename: "childfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      }
    )
    expect(attachResDetails.data.ID).to.be.ok

    await uploadAttachmentContent(testID, attachResTest.data.ID, "content/sample.pdf", "NonDraftTest")
    await uploadAttachmentContent(detailsID, attachResDetails.data.ID, "content/sample.pdf", "SingleTestDetails")

    // Delete the parent entity
    const delParentEntity = await axios.delete(
      `odata/v4/processor/NonDraftTest(ID=${testID})`
    )
    expect(delParentEntity.status).to.equal(204)

    // Confirm parent attachment is deleted
    await axios.get(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`
    ).catch(e => {
      expect(e.response.status).to.equal(404)
    })

    // Confirm child attachment is deleted
    await axios.get(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`
    ).catch(e => {
      expect(e.response.status).to.equal(404)
    })

    // Wait a bit to ensure async deletion is processed
    await delay(2000)

    // Verify delete was called
    expect(deleteSpy.mock.calls.length).to.be.greaterThan(0)

    deleteSpy.mockRestore()
  })
})

function createHelpers(axios) {
  return {
    createAttachmentMetadata: async (incidentID, filename = "sample.pdf") => {
      const response = await axios.post(
        `/odata/v4/admin/Incidents(${incidentID})/attachments`,
        { filename: filename },
        { headers: { "Content-Type": "application/json" } }
      )
      return response.data.ID
    },
    uploadAttachmentContent: async (
      entityID,
      attachmentID,
      contentPath = "content/sample.pdf",
      entityName = "Incidents"
    ) => {
      const fileContent = fs.readFileSync(
        path.join(__dirname, "..", "integration", contentPath)
      )
      const response = await axios.put(
        `/odata/v4/admin/${entityName}(${entityID})/attachments(up__ID=${entityID},ID=${attachmentID})/content`,
        fileContent,
        {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": fileContent.length,
          },
        }
      )
      return response
    },
  }
}
