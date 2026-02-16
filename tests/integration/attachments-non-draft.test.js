const cds = require("@sap/cds")
const { test } = cds.test()
const {
  waitForScanStatus,
  newIncident,
  waitForDeletion,
} = require("../utils/testUtils")
const { join, resolve } = cds.utils.path
const { createReadStream, readFileSync, statSync } = cds.utils.fs

const app = resolve(__dirname, "../incidents-app")
const { axios, GET, POST, PATCH, DELETE, PUT } =
  require("@cap-js/cds-test")(app)

describe("Tests for uploading/deleting and fetching attachments through API calls with non draft mode", () => {
  const isNotLocal = cds.env.requires?.attachments?.kind === "db" ? it.skip : it

  axios.defaults.auth = { username: "alice" }
  let log = test.log()
  const { createAttachmentMetadata, uploadAttachmentContent } = createHelpers()

  it("Create new entity and ensuring nothing attachment related crashes", async () => {
    const resCreate = await POST("/odata/v4/admin/Incidents", {
      title: "New Incident",
    })
    expect(resCreate.status).toBe(201)
    expect(resCreate.data.title).toBe("New Incident")
  })

  it("should create attachment metadata", async () => {
    const incidentID = await newIncident(POST, "admin")
    const attachmentID = await createAttachmentMetadata(incidentID)
    expect(attachmentID).toBeDefined()
  })

  it("should upload attachment content", async () => {
    const incidentID = await newIncident(POST, "admin")
    const attachmentID = await createAttachmentMetadata(incidentID)
    const response = await uploadAttachmentContent(incidentID, attachmentID)
    expect(response.status).toBe(204)
  })

  it("unknown extension throws warning", async () => {
    const incidentID = await newIncident(POST, "admin")
    const response = await POST(
      `/odata/v4/admin/Incidents(${incidentID})/attachments`,
      { filename: "sample.madeupextension" },
      { headers: { "Content-Type": "application/json" } },
    )
    expect(response.status).toBe(201)
    expect(log.output.length).toBeGreaterThan(0)
    expect(log.output).toContain(
      'is uploaded whose extension "madeupextension" is not known! Falling back to "application/octet-stream"',
    )
  })

  it("should list attachments for incident", async () => {
    const incidentID = await newIncident(POST, "admin")
    const attachmentID = await createAttachmentMetadata(incidentID)
    const scanCleanWaiter = waitForScanStatus("Clean", attachmentID)
    await uploadAttachmentContent(incidentID, attachmentID)

    // Wait for scanning to complete
    await scanCleanWaiter

    const response = await GET(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments`,
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
    const incidentID = await newIncident(POST, "admin")
    const attachmentID = await createAttachmentMetadata(incidentID)
    const scanCleanWaiter = waitForScanStatus("Clean", attachmentID)
    await uploadAttachmentContent(incidentID, attachmentID)

    // Wait for scanning to complete
    await scanCleanWaiter

    const response = await GET(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`,
      { responseType: "arraybuffer" },
    )
    expect(response.status).toBe(200)
    expect(response.data).toBeDefined()
    expect(response.data.length).toBeGreaterThan(0)

    const originalContent = readFileSync(join(__dirname, "content/sample.pdf"))
    expect(Buffer.compare(response.data, originalContent)).toBe(0)
  })

  it("should delete attachment and verify deletion", async () => {
    const incidentID = await newIncident(POST, "admin")
    const attachmentID = await createAttachmentMetadata(incidentID)
    const scanCleanWaiter = waitForScanStatus("Clean", attachmentID)
    await uploadAttachmentContent(incidentID, attachmentID)

    // Wait for scanning to complete
    await scanCleanWaiter

    // Delete the attachment
    const deleteResponse = await DELETE(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`,
    )
    expect(deleteResponse.status).toBe(204)

    // Verify the attachment is deleted
    await GET(
      `/odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`,
    ).catch((e) => {
      expect(e.response.status).toBe(404)
    })
  })

  it("Updating attachments via srv.run works", async () => {
    const incidentID = await newIncident(POST, "admin")
    const AdminSrv = await cds.connect.to("AdminService")

    const attachmentsID = cds.utils.uuid()
    const doc = await POST(
      `odata/v4/admin/Incidents(ID=${incidentID})/attachments`,
      {
        ID: attachmentsID,
        up__ID: incidentID,
      },
    )

    const scanCleanWaiter = waitForScanStatus("Clean")

    const fileContent = createReadStream(join(__dirname, "content/sample.pdf"))
    const contentLength = statSync(join(__dirname, "content/sample.pdf")).size

    const user = new cds.User({ id: "alice", roles: { admin: 1 } })
    const req = new cds.Request({
      query: UPDATE.entity({
        ref: [
          {
            id: "AdminService.Incidents",
            where: [{ ref: ["ID"] }, "=", { val: incidentID }],
          },
          {
            id: "attachments",
            where: [{ ref: ["ID"] }, "=", { val: doc.data.ID }],
          },
        ],
      }).set({
        filename: "test.pdf",
        content: fileContent,
        mimeType: "application/pdf",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      }),
      user: user,
      headers: { "content-length": contentLength },
    })
    const ctx = cds.EventContext.for({
      id: cds.utils.uuid(),
      http: { req: null, res: null },
    })
    ctx.user = user
    await cds._with(ctx, () => AdminSrv.dispatch(req))

    const response = await GET(
      `odata/v4/admin/Incidents(ID=${incidentID})/attachments`,
    )
    //the data should have no attachments
    expect(response.status).toBe(200)
    expect(response.data.value.length).toBe(1)

    await scanCleanWaiter

    //content should not be there
    const responseContent = await GET(
      `odata/v4/admin/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentsID})/content`,
    )
    expect(responseContent.status).toBe(200)
  })

  it("should NOT allow overwriting an existing attachment file via /content handler", async () => {
    const incidentID = await newIncident(POST, "admin")
    // Create attachment metadata
    const attachmentID = await createAttachmentMetadata(incidentID)
    expect(attachmentID).toBeDefined()

    // Upload the file content
    const response = await uploadAttachmentContent(incidentID, attachmentID)
    expect(response.status).toBe(204)

    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )
    let error
    try {
      await PUT(
        `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`,
        fileContent,
        {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": fileContent.length,
          },
        },
      )
    } catch (e) {
      error = e
    }

    // This should fail with a 409 Conflict
    expect(error).toBeDefined()
    expect(error.response.status).toBe(409)
    expect(error.response.data.error.message).toMatch(
      /Attachment sample.pdf already exists and cannot be overwritten/i,
    )
  })

  it("should add and fetch attachments for both NonDraftTest and SingleTestDetails in non-draft mode", async () => {
    const testID = cds.utils.uuid()
    const detailsID = cds.utils.uuid()
    await POST(`odata/v4/processor/NonDraftTest`, {
      ID: testID,
      name: "Non-draft Test",
      singledetails: { ID: detailsID, abc: "child" },
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
      { headers: { "Content-Type": "application/json" } },
    )
    expect(attachResTest.data.ID).toBeTruthy()

    const attachResDetails = await POST(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments`,
      {
        up__ID: detailsID,
        filename: "childfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachResDetails.data.ID).toBeTruthy()

    const parentAttachment = await GET(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`,
    )

    expect(parentAttachment.status).toBe(200)
    expect(parentAttachment.data.ID).toBe(attachResTest.data.ID)
    expect(parentAttachment.data.filename).toBe("parentfile.pdf")

    const childAttachment = await GET(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`,
    )
    expect(childAttachment.status).toBe(200)
    expect(childAttachment.data.ID).toBe(attachResDetails.data.ID)
    expect(childAttachment.data.filename).toBe("childfile.pdf")
  })

  it("should delete attachments for both NonDraftTest and SingleTestDetails in non-draft mode", async () => {
    const testID = cds.utils.uuid()
    const detailsID = cds.utils.uuid()
    await POST(`odata/v4/processor/NonDraftTest`, {
      ID: testID,
      name: "Non-draft Test",
      singledetails: { ID: detailsID, abc: "child" },
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
      { headers: { "Content-Type": "application/json" } },
    )
    expect(attachResTest.data.ID).toBeTruthy()

    const attachResDetails = await POST(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments`,
      {
        up__ID: detailsID,
        filename: "childfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachResDetails.data.ID).toBeTruthy()

    // Delete parent attachment
    const delParent = await DELETE(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`,
    )
    expect(delParent.status).toBe(204)

    // Delete child attachment
    const delChild = await DELETE(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`,
    )
    expect(delChild.status).toBe(204)

    // Confirm parent attachment is deleted
    await GET(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`,
    ).catch((e) => {
      expect(e.response.status).toBe(404)
    })

    // Confirm child attachment is deleted
    await GET(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`,
    ).catch((e) => {
      expect(e.response.status).toBe(404)
    })
  })

  isNotLocal(
    "should delete file from object store if data is deleted",
    async () => {
      const detailsID = cds.utils.uuid()

      const testID = await newIncident(
        POST,
        "processor",
        {
          name: "Non-draft Test",
          singledetails: { ID: detailsID, abc: "child" },
        },
        "NonDraftTest",
      )

      const attachResTest = await POST(
        `odata/v4/processor/NonDraftTest(ID=${testID})/attachments`,
        {
          up__ID: testID,
          filename: "parentfile.pdf",
          mimeType: "application/pdf",
          createdAt: new Date(),
          createdBy: "alice",
        },
      )
      expect(attachResTest.data.url).toBeTruthy()
      await uploadAttachmentContent(
        testID,
        attachResTest.data.ID,
        "content/sample.pdf",
        "processor",
        "NonDraftTest",
      )

      const deletion = waitForDeletion(attachResTest.data.url)

      // Delete parent attachment
      const delParent = await DELETE(
        `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`,
      )
      expect(delParent.status).toBe(204)

      // Confirm parent attachment is deleted
      await GET(
        `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`,
      ).catch((e) => {
        expect(e.response.status).toBe(404)
      })

      expect(await deletion).toBe(true)
    },
  )

  it("should create NonDraftTest entities using programmatic INSERT and add attachments", async () => {
    const firstID = cds.utils.uuid()
    const secondID = cds.utils.uuid()

    // Use programmatic INSERT to create entities
    await INSERT.into("sap.capire.incidents.NonDraftTest").entries(
      {
        ID: firstID,
        name: "Test Entry 1",
      },
      {
        ID: secondID,
        name: "Test Entry 2",
      }
    )

    // Verify entities were created by adding attachments
    const attachRes1 = await POST(
      `odata/v4/processor/NonDraftTest(ID=${firstID})/attachments`,
      {
        up__ID: firstID,
        filename: "file1.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      }
    )
    expect(attachRes1.data.ID).toBeTruthy()

    const attachRes2 = await POST(
      `odata/v4/processor/NonDraftTest(ID=${secondID})/attachments`,
      {
        up__ID: secondID,
        filename: "file2.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      }
    )
    expect(attachRes2.data.ID).toBeTruthy()

    // Verify attachments can be fetched
    const attachment1 = await GET(
      `odata/v4/processor/NonDraftTest(ID=${firstID})/attachments(up__ID=${firstID},ID=${attachRes1.data.ID})`
    )
    expect(attachment1.status).toBe(200)
    expect(attachment1.data.filename).toBe("file1.pdf")

    const attachment2 = await GET(
      `odata/v4/processor/NonDraftTest(ID=${secondID})/attachments(up__ID=${secondID},ID=${attachRes2.data.ID})`
    )
    expect(attachment2.status).toBe(200)
    expect(attachment2.data.filename).toBe("file2.pdf")
  })

  it("should delete attachments for both NonDraftTest and SingleTestDetails when entities are deleted in non-draft mode", async () => {
    const testID = cds.utils.uuid()
    const detailsID = cds.utils.uuid()
    await POST(`odata/v4/processor/NonDraftTest`, {
      ID: testID,
      name: "Non-draft Test",
      singledetails: { ID: detailsID, abc: "child" },
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
      { headers: { "Content-Type": "application/json" } },
    )
    expect(attachResTest.data.ID).toBeTruthy()

    const attachResDetails = await POST(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments`,
      {
        up__ID: detailsID,
        filename: "childfile.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(),
        createdBy: "alice",
      },
    )
    expect(attachResDetails.data.ID).toBeTruthy()

    // Delete the parent entity
    const delParentEntity = await DELETE(
      `odata/v4/processor/NonDraftTest(ID=${testID})`,
    )
    expect(delParentEntity.status).toBe(204)

    // Confirm parent attachment is deleted
    await GET(
      `odata/v4/processor/NonDraftTest(ID=${testID})/attachments(up__ID=${testID},ID=${attachResTest.data.ID})`,
    ).catch((e) => {
      expect(e.response.status).toBe(404)
    })

    // Confirm child attachment is deleted
    await GET(
      `odata/v4/processor/SingleTestDetails(ID=${detailsID})/attachments(up__ID=${detailsID},ID=${attachResDetails.data.ID})`,
    ).catch((e) => {
      expect(e.response.status).toBe(404)
    })
  })
})

describe("Testing max and min amounts of attachments", () => {
  it("Create of record in draft gives warning when maximum is met", async () => {
    const incidentID = await newIncident(POST, "validation-test-non-draft", {
      title: `Incident ${Math.floor(Math.random() * 1000)}`,
      customer_ID: "1004155",
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
      ],
      hiddenAttachments2: [
        {
          filename: "sample.pdf",
          mimeType: "application/jpeg; charset=UTF-8",
          createdAt: new Date(
            Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
          ),
          createdBy: "alice",
        },
      ],
    })
    await POST(
      `odata/v4/validation-test-non-draft/Incidents(ID=${incidentID})/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/jpeg; charset=UTF-8",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
        ),
        createdBy: "alice",
      },
    ).catch((e) => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.code).toMatch("MaximumAmountExceeded")
    })
  })

  it("Delete of record in draft gives warning when minimum is not met", async () => {
    const incidentID = cds.utils.uuid()
    await INSERT.into(
      cds.model.definitions["ValidationTestNonDraftService.Incidents"],
    ).entries({
      ID: incidentID,
      title: "ABCDEFG",
      customer_ID: "1004155",
      urgency_code: "M",
    })
    const { data: newAttachment } = await POST(
      `odata/v4/validation-test-non-draft/Incidents(ID=${incidentID})/attachments`,
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
    await DELETE(
      `odata/v4/validation-test-non-draft/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${newAttachment.ID})`,
    ).catch((e) => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.code).toMatch("MinimumAmountNotFulfilled")
    })
  })

  it("Deep create of new draft gives warning when minimum is not met or maximum exceeded", async () => {
    const incidentID = cds.utils.uuid()
    await INSERT.into(
      cds.model.definitions["ValidationTestNonDraftService.Incidents"],
    ).entries({
      ID: incidentID,
      title: "ABCDEFG",
      customer_ID: "1004155",
      urgency_code: "M",
    })
    const { status } = await POST(
      `odata/v4/validation-test-non-draft/Incidents(ID=${incidentID})/conversation`,
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

    await POST(
      `odata/v4/validation-test-non-draft/Incidents(ID=${incidentID})/conversation`,
      {
        up__ID: incidentID,
        ID: cds.utils.uuid(),
        message: "ABC",
        attachments: [],
      },
    ).catch((e) => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.code).toMatch(
        "MinimumAmountNotFulfilled|ValidationTestNonDraftService.Incidents.conversation",
      )
    })

    await POST(
      `odata/v4/validation-test-non-draft/Incidents(ID=${incidentID})/conversation`,
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
    ).catch((e) => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.code).toMatch("MaximumAmountExceeded")
    })
  })

  it("Deep update of draft gives warning when minimum is not met or maximum exceeded", async () => {
    const incidentID = cds.utils.uuid()
    await INSERT.into(
      cds.model.definitions["ValidationTestNonDraftService.Incidents"],
    ).entries({
      ID: incidentID,
      title: "ABCDEFG",
      customer_ID: "1004155",
      urgency_code: "M",
    })
    const conversationID = cds.utils.uuid()
    await INSERT.into(
      cds.model.definitions[
        "ValidationTestNonDraftService.Incidents.conversation"
      ],
    ).entries({
      up__ID: incidentID,
      ID: conversationID,
      message: "ABC",
    })

    const { status } = await PATCH(
      `odata/v4/validation-test-non-draft/Incidents(ID=${incidentID})/conversation(ID=${conversationID})`,
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
          },
        ],
      },
    )
    expect(status).toEqual(200)

    await PATCH(
      `odata/v4/validation-test-non-draft/Incidents(ID=${incidentID})/conversation(ID=${conversationID})`,
      {
        message: "ABC",
        attachments: [],
      },
    ).catch((e) => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.code).toMatch(
        "MinimumAmountNotFulfilled|ValidationTestNonDraftService.Incidents.conversation",
      )
    })

    await PATCH(
      `odata/v4/validation-test-non-draft/Incidents(ID=${incidentID})/conversation(ID=${conversationID})`,
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
    ).catch((e) => {
      expect(e.status).toEqual(400)
      expect(e.response.data.error.code).toMatch("MaximumAmountExceeded")
    })
  })

  it("custom error message can be specified targeting composition property", async () => {
    await POST(`odata/v4/validation-test-non-draft/Incidents`, {
      customer_ID: "1004155",
      title: "ABC",
      conversation: [
        {
          ID: cds.utils.uuid(),
          message: "ABC",
          attachments: [],
        },
      ],
    }).catch((e) => {
      expect(e.status).toEqual(400)
      const err = e.response.data.error.details.find((e) =>
        e.target.startsWith("conversation"),
      )
      expect(err.code).toEqual(
        "MinimumAmountNotFulfilled|ValidationTestNonDraftService.Incidents.conversation",
      )
    })
  })

  it("custom error message can be specified for entity", async () => {
    await POST(`odata/v4/validation-test-non-draft/Incidents`, {
      customer_ID: "1004155",
      title: "ABC",
      urgency_code: "H",
      attachments: [],
    }).catch((e) => {
      expect(e.status).toEqual(400)
      const err = e.response.data.error.details.find((e) =>
        e.target.startsWith("hiddenAttachments2"),
      )
      expect(err.code).toEqual(
        "MinimumAmountNotFulfilled|ValidationTestNonDraftService.Incidents|hiddenAttachments2",
      )
    })
  })
})
describe("Row-level security on attachments composition", () => {
  let restrictionID, attachmentID

  beforeAll(async () => {
    const scanCleanWaiter = waitForScanStatus("Clean")
    // Create a Incidents entity as a Manager
    restrictionID = cds.utils.uuid()
    await POST(
      "/odata/v4/restriction/Incidents",
      {
        ID: restrictionID,
        title: "ABC",
      },
      { auth: { username: "alice" } },
    )

    // Create an attachment as alice and save the ID
    const attachRes = await POST(
      `/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments`,
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
      `/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments(up__ID=${restrictionID},ID=${attachmentID})/content`,
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
  })

  it("should allow DOWNLOAD attachment content for authorized user (alice)", async () => {
    // Now, try to GET the attachment content as alice
    const getRes = await GET(
      `/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments(up__ID=${restrictionID},ID=${attachmentID})/content`,
      {
        auth: { username: "alice" },
      },
    )
    expect(getRes.status).toEqual(200)
    expect(getRes.data).not.toBeUndefined()
  })

  it("should reject CREATE attachment for unauthorized user", async () => {
    await POST(
      `/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments`,
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
    await axios
      .patch(
        `/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments(up__ID=${restrictionID},ID=${attachmentID})`,
        {
          note: "Should fail",
        },
        { auth: { username: "bob" } },
      )
      .catch((e) => {
        expect(e.status).toEqual(403)
      })
  })

  it("should reject DOWNLOAD attachment content for unauthorized user", async () => {
    await GET(
      `/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments(up__ID=${restrictionID},ID=${attachmentID})/content`,
      {
        auth: { username: "bob" },
      },
    ).catch((e) => {
      expect(e.status).toEqual(403)
    })
  })

  it("should reject DELETE attachment for unauthorized user", async () => {
    await DELETE(
      `/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments(up__ID=${restrictionID},ID=${attachmentID})`,
      {
        auth: { username: "bob" },
      },
    ).catch((e) => {
      expect(e.status).toEqual(403)
    })
  })

  it("should not allow bob to PUT into file alice has POSTed", async () => {
    const attachRes = await POST(
      `/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments`,
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
      `/odata/v4/restriction/Incidents(ID=${restrictionID})/attachments(up__ID=${restrictionID},ID=${attachRes.data.ID})/content`,
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
  })
})

function createHelpers() {
  return {
    createAttachmentMetadata: async (incidentID, filename = "sample.pdf") => {
      const response = await POST(
        `/odata/v4/admin/Incidents(${incidentID})/attachments`,
        { filename: filename },
        { headers: { "Content-Type": "application/json" } },
      )
      return response.data.ID
    },
    uploadAttachmentContent: async (
      incidentID,
      attachmentID,
      contentPath = "content/sample.pdf",
      service = "admin",
      entity = "Incidents",
    ) => {
      const fileContent = readFileSync(
        join(__dirname, "..", "integration", contentPath),
      )
      const response = await PUT(
        `/odata/v4/${service}/${entity}(${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`,
        fileContent,
        {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": fileContent.length,
          },
        },
      )
      return response
    },
  }
}
