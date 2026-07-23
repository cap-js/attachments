const cds = require("@sap/cds")
const { RequestSend } = require("../utils/api")
const { waitForScanStatus, newIncident } = require("../utils/testUtils")
const path = require("path")

const app = path.resolve(__dirname, "../incidents-app")
const { axios, GET, POST, DELETE, PATCH, PUT } = cds.test(app)
axios.defaults.auth = { username: "alice" }
const { createReadStream, readFileSync } = cds.utils.fs
const { join } = cds.utils.path

let utils = null

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

  it("Adds @UI.FieldGroup and @UI.Facet for an inline attachment when only sap.attachments.Attachment is used (no Attachments composition)", () => {
    const entity = cds.model.definitions["ProcessorService.SingleAttachment"]
    expect(entity["@UI.FieldGroup#myAttachment"]).toBeDefined()
    const inlineFacet = entity["@UI.Facets"].find(
      (f) => f.Target === "@UI.FieldGroup#myAttachment",
    )
    expect(inlineFacet).toBeDefined()
    expect(inlineFacet.$Type).toBe("UI.ReferenceFacet")
  })

  it("Does not add an inline @UI.FieldGroup facet when the entity has no inline attachment fields", () => {
    const entity = cds.model.definitions["ProcessorService.Test"]
    const facets = entity["@UI.Facets"]
    expect(facets).toBeDefined()
    const inlineFacets = facets.filter((f) =>
      f.Target?.startsWith("@UI.FieldGroup#"),
    )
    expect(inlineFacets).toHaveLength(0)
  })

  it("Propagates @UI.Hidden from inline attachment content element to its facet", () => {
    const entity = cds.model.definitions["ProcessorService.SingleAttachment"]
    const facets = entity["@UI.Facets"]
    const inlineFacet = facets.find(
      (f) => f.Target === "@UI.FieldGroup#myAttachment",
    )
    expect(inlineFacet).toBeDefined()
    expect(inlineFacet["@UI.Hidden"]).toBe(true)
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

  it("Should allow DOWNLOAD attachment content for authorized user (alice)", async () => {
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

  it("Should reject CREATE attachment for unauthorized user", async () => {
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

  it("Should reject UPDATE attachment for unauthorized user", async () => {
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

  it("Should reject DOWNLOAD attachment content for unauthorized user", async () => {
    await GET(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=true)/attachments(up__ID=${restrictionID},ID=${attachmentID},IsActiveEntity=true)/content`,
      {
        auth: { username: "bob" },
      },
    ).catch((e) => {
      expect(e.status).toEqual(403)
    })
  })

  it("Should reject DELETE attachment for unauthorized user", async () => {
    await DELETE(
      `/odata/v4/restriction/DraftIcidents(ID=${restrictionID},IsActiveEntity=true)/attachments(up__ID=${restrictionID},ID=${attachmentID},IsActiveEntity=true)`,
      {
        auth: { username: "bob" },
      },
    ).catch((e) => {
      expect(e.status).toEqual(403)
    })
  })

  it("Should not allow bob to PUT into file alice has POSTed", async () => {
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
