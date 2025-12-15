const path = require("path")
const fs = require("fs")
const cds = require("@sap/cds")
const { test } = cds.test()
const { waitForScanStatus } = require("../utils/testUtils")

const app = path.resolve(__dirname, "../incidents-app")
const { expect, axios, GET, POST, DELETE } = require("@cap-js/cds-test")(app)

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
    const resCreate = await POST('/odata/v4/admin/Incidents', {
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
    const response = await POST(
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

    const response = await GET(
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

    const response = await GET(
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
    const deleteResponse = await DELETE(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
    )
    expect(deleteResponse.status).to.equal(204)

    // Verify the attachment is deleted
    await GET(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
    ).catch(e => {
      expect(e.status).to.equal(404)
    })
  })

  it("Updating attachments via srv.run works", async () => {
    const AdminSrv = await cds.connect.to('AdminService')

    const attachmentsID = cds.utils.uuid();
    const doc = await POST(
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

    const response = await GET(
      `odata/v4/admin/Incidents(ID=${incidentID})/attachments`
    )
    //the data should have no attachments
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(1)

    await scanCleanWaiter

    //content should not be there
    const responseContent = await GET(
      `odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentsID})/content`
    )
    expect(responseContent.status).to.equal(200)
  })

  it("should add and fetch attachments for both NonDraftTest and SingleTestDetails in non-draft mode", async () => {
    const testID = cds.utils.uuid()
    const detailsID = cds.utils.uuid()
    await POST(`odata/v4/processor/NonDraftTest`, {
      ID: testID,
      name: "Non-draft Test",
      singledetails: { ID: detailsID, abc: "child" }
    })

    const attachResTest = await POST(
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
    
    const attachResDetails = await POST(
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

    const parentAttachment = await GET(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`
    )

    expect(parentAttachment.status).to.equal(200)
    expect(parentAttachment.data.ID).to.equal(attachResTest.data.ID)
    expect(parentAttachment.data.filename).to.equal("parentfile.pdf")

    const childAttachment = await GET(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`
    )
    expect(childAttachment.status).to.equal(200)
    expect(childAttachment.data.ID).to.equal(attachResDetails.data.ID)
    expect(childAttachment.data.filename).to.equal("childfile.pdf")
  })

  it("should delete attachments for both NonDraftTest and SingleTestDetails in non-draft mode", async () => {
    const testID = cds.utils.uuid()
    const detailsID = cds.utils.uuid()
    await POST(`odata/v4/processor/NonDraftTest`, {
      ID: testID,
      name: "Non-draft Test",
      singledetails: { ID: detailsID, abc: "child" }
    })

    const attachResTest = await POST(
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
    
    const attachResDetails = await POST(
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
    const delParent = await DELETE(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`
    )
    expect(delParent.status).to.equal(204)

    // Delete child attachment
    const delChild = await DELETE(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`
    )
    expect(delChild.status).to.equal(204)

    // Confirm parent attachment is deleted
    await GET(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`
    ).catch(e => {
      expect(e.response.status).to.equal(404)
    })

    // Confirm child attachment is deleted
    await GET(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`
    ).catch(e => {
      expect(e.response.status).to.equal(404)
    })
  })

  it("should delete attachments for both NonDraftTest and SingleTestDetails when entities are deleted in non-draft mode", async () => {
    const testID = cds.utils.uuid()
    const detailsID = cds.utils.uuid()
    await POST(`odata/v4/processor/NonDraftTest`, {
      ID: testID,
      name: "Non-draft Test",
      singledetails: { ID: detailsID, abc: "child" }
    })

    const attachResTest = await POST(
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
    
    const attachResDetails = await POST(
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

    // Delete the parent entity
    const delParentEntity = await DELETE(
      `odata/v4/processor/NonDraftTest(ID=${testID})`
    )
    expect(delParentEntity.status).to.equal(204)

    // Confirm parent attachment is deleted
    await GET(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`
    ).catch(e => {
      expect(e.response.status).to.equal(404)
    })

    // Confirm child attachment is deleted
    await GET(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`
    ).catch(e => {
      expect(e.response.status).to.equal(404)
    })
  })
})

describe("Row-level security on attachments composition", () => {
  let restrictionID, attachmentID

  beforeAll(async () => {
    const scanCleanWaiter = waitForScanStatus('Clean')
    // Create a Incidents entity as a Manager
    restrictionID = cds.utils.uuid()
    await POST("/odata/v4/restriction/Incidents", {
      ID: restrictionID,
      title: "ABC"
    }, { auth: { username: "alice" } })

    // Create an attachment as alice and save the ID
    const attachRes = await POST(`/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments`, {
      up__ID: restrictionID,
      filename: "test.pdf",
      mimeType: "application/pdf"
    }, { auth: { username: "alice" } })
    attachmentID = attachRes.data.ID

    const fileContent = fs.readFileSync(
      path.join(__dirname, "..", "integration", "content/sample.pdf")
    )
    await axios.put(
      `/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments(up__ID=${restrictionID},ID=${attachmentID})/content`,
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
  })

  it("should allow DOWNLOAD attachment content for authorized user (alice)", async () => {
    // Now, try to GET the attachment content as alice
    const getRes = await GET(`/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments(up__ID=${restrictionID},ID=${attachmentID})/content`, {
      auth: { username: "alice" }
    })
    expect(getRes.status).to.equal(200)
    expect(getRes.data).to.not.be.undefined
  })

  it("should reject CREATE attachment for unauthorized user", async () => {
    await POST(`/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments`, {
      up__ID: restrictionID,
      filename: "test.pdf",
      mimeType: "application/pdf"
    }, { auth: { username: "bob" } }).catch(e => {
      expect(e.status).to.equal(403)
    })
  })

  it("should reject UPDATE attachment for unauthorized user", async () => {
    // Assume an attachment exists, try to update as bob
    await axios.patch(`/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments(up__ID=${restrictionID},ID=${attachmentID})`, {
      note: "Should fail"
    }, { auth: { username: "bob" } }).catch(e => {
      expect(e.status).to.equal(403)
    })
  })

  it("should reject DOWNLOAD attachment content for unauthorized user", async () => {
    await GET(`/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments(up__ID=${restrictionID},ID=${attachmentID})/content`, {
      auth: { username: "bob" }
    }).catch(e => {
      expect(e.status).to.equal(403)
    })
  })

  it("should reject DELETE attachment for unauthorized user", async () => {
    await DELETE(`/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments(up__ID=${restrictionID},ID=${attachmentID})`, {
      auth: { username: "bob" }
    }).catch(e => {
      expect(e.status).to.equal(403)
    })
  })

  it("should not allow bob to PUT into file alice has POSTed", async () => {
    const attachRes = await POST(`/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments`, {
      up__ID: restrictionID,
      filename: "newfile.pdf",
      mimeType: "application/pdf"
    }, { auth: { username: "alice" } })

    const fileContent = fs.readFileSync(
      path.join(__dirname, "..", "integration", "content/sample.pdf")
    )
    await axios.put(
      `/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments(up__ID=${restrictionID},ID=${attachRes.data.ID})/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
        auth: { username: "bob" }
      }
    ).catch(e => {
      expect(e.status).to.equal(403)
    })
  })
})

function createHelpers(axios) {
  return {
    createAttachmentMetadata: async (incidentID, filename = "sample.pdf") => {
      const response = await POST(
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
