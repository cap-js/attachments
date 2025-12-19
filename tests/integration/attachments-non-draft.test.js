const path = require("path")
const fs = require("fs")
const cds = require("@sap/cds")
const { test } = cds.test()
const { waitForScanStatus } = require("../utils/testUtils")

const app = path.resolve(__dirname, "../incidents-app")
const { axios } = require("@cap-js/cds-test")(app)

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
    expect(resCreate.status).toBe(201)
    expect(resCreate.data.title).toBe('New Incident')
  })

  it("should create attachment metadata", async () => {
    const attachmentID = await createAttachmentMetadata(incidentID)
    expect(attachmentID).toBeDefined()
  })

  it("should upload attachment content", async () => {
    const attachmentID = await createAttachmentMetadata(incidentID)
    const response = await uploadAttachmentContent(incidentID, attachmentID)
    expect(response.status).toBe(204)
  })

  it("unknown extension throws warning", async () => {
    const response = await axios.post(
      `/odata/v4/admin/Incidents(${incidentID})/attachments`,
      { filename: 'sample.madeupextension' },
      { headers: { "Content-Type": "application/json" } }
    )
    expect(response.status).toBe(201);
    expect(log.output.length).toBeGreaterThan(0)
    expect(log.output).toContain('is uploaded whose extension "madeupextension" is not known! Falling back to "application/octet-stream"')
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
    expect(response.status).toBe(200)

    const attachment = response.data.value[0]

    expect(attachment.up__ID).toBe(incidentID)
    expect(attachment.filename).toBe("sample.pdf")
    expect(attachment.status).toBe("Clean")
    expect(attachment.content).toBeUndefined()
    expect(response.data.value[0].ID).toBe(attachmentID)
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
    expect(response.status).toBe(200)
    expect(response.data).toBeDefined()
    expect(response.data.length).toBeGreaterThan(0)

    const originalContent = fs.readFileSync(
      path.join(__dirname, "content/sample.pdf")
    )
    expect(Buffer.compare(response.data, originalContent)).toBe(0)
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
    expect(deleteResponse.status).toBe(204)

    // Verify the attachment is deleted
    await axios.get(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
    ).catch(e => {
      expect(e.response.status).toBe(404)
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
    expect(response.status).toBe(200)
    expect(response.data.value.length).toBe(1)

    await scanCleanWaiter

    //content should not be there
    const responseContent = await axios.get(
      `odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentsID})/content`
    )
    expect(responseContent.status).toBe(200)
  })

  it("should NOT allow overwriting an existing attachment file via /content handler", async () => {
    // Create attachment metadata
    const attachmentID = await createAttachmentMetadata(incidentID)
    expect(attachmentID).toBeDefined()

    // Upload the file content
    const response = await uploadAttachmentContent(incidentID, attachmentID)
    expect(response.status).toBe(204)

    const fileContent = fs.readFileSync(
      path.join(__dirname, "..", "integration", "content/sample.pdf")
    )
    let error
    try {
      await axios.put(
        `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`,
        fileContent,
        {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": fileContent.length,
          },
        }
      )
    } catch (e) {
      error = e
    }

    // This should fail with a 409 Conflict
    expect(error).toBeDefined()
    expect(error.response.status).toBe(409)
    expect(error.response.data.error.message).toMatch(/Attachment sample.pdf already exists and cannot be overwritten/i)
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
    expect(attachResTest.data.ID).toBeTruthy()

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
    expect(attachResDetails.data.ID).toBeTruthy()

    const parentAttachment = await axios.get(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`
    )

    expect(parentAttachment.status).toBe(200)
    expect(parentAttachment.data.ID).toBe(attachResTest.data.ID)
    expect(parentAttachment.data.filename).toBe("parentfile.pdf")

    const childAttachment = await axios.get(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`
    )
    expect(childAttachment.status).toBe(200)
    expect(childAttachment.data.ID).toBe(attachResDetails.data.ID)
    expect(childAttachment.data.filename).toBe("childfile.pdf")
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
    expect(attachResTest.data.ID).toBeTruthy()

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
    expect(attachResDetails.data.ID).toBeTruthy()

    // Delete parent attachment
    const delParent = await axios.delete(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`
    )
    expect(delParent.status).toBe(204)

    // Delete child attachment
    const delChild = await axios.delete(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`
    )
    expect(delChild.status).toBe(204)

    // Confirm parent attachment is deleted
    await axios.get(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`
    ).catch(e => {
      expect(e.response.status).toBe(404)
    })

    // Confirm child attachment is deleted
    await axios.get(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`
    ).catch(e => {
      expect(e.response.status).toBe(404)
    })
  })

  it("should delete attachments for both NonDraftTest and SingleTestDetails when entities are deleted in non-draft mode", async () => {
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
    expect(attachResTest.data.ID).toBeTruthy()

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
    expect(attachResDetails.data.ID).toBeTruthy()

    // Delete the parent entity
    const delParentEntity = await axios.delete(
      `odata/v4/processor/NonDraftTest(ID=${testID})`
    )
    expect(delParentEntity.status).toBe(204)

    // Confirm parent attachment is deleted
    await axios.get(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`
    ).catch(e => {
      expect(e.response.status).toBe(404)
    })

    // Confirm child attachment is deleted
    await axios.get(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`
    ).catch(e => {
      expect(e.response.status).toBe(404)
    })
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
      incidentID,
      attachmentID,
      contentPath = "content/sample.pdf"
    ) => {
      const fileContent = fs.readFileSync(
        path.join(__dirname, "..", "integration", contentPath)
      )
      const response = await axios.put(
        `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`,
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
