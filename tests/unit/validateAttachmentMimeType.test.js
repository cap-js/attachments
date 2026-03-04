require("../../lib/csn-runtime-extension")
const cds = require("@sap/cds")
const { readFileSync } = cds.utils.fs
const { join } = cds.utils.path
const app = join(__dirname, "../incidents-app")
const { axios, POST, PUT, GET } = cds.test(app)
const { validateAttachmentMimeType } = require("../../lib/generic-handlers")
const { newIncident } = require("../utils/testUtils")

describe("validateAttachmentMimeType - Content-Type header bypass security test", () => {
  axios.defaults.auth = { username: "alice" }

  /**
   * Security Test: Content-Type Header Bypass Attack
   *
   * This test validates that a malicious user cannot bypass mimetype restrictions
   * by intercepting the PUT request and changing the Content-Type header.
   *
   * Attack scenario:
   * 1. User creates an attachment with filename "notes.txt"
   * 2. System assigns mimeType "text/plain" based on file extension
   * 3. mediaTypeAttachments only allows 'image/jpeg' per @Core.AcceptableMediaTypes
   * 4. Attacker intercepts PUT request and changes Content-Type header to "text/html"
   * 5. System should reject because mimeType (text/plain) is not in allowed list
   *
   * The mimeType must be validated against @Core.AcceptableMediaTypes during PUT,
   * using the mimeType stored in the database (derived from filename), NOT the
   * Content-Type header provided in the request.
   */
  it("should reject upload when Content-Type header is manually changed to bypass allowed mimetypes", async () => {
    const incidentID = await newIncident(POST, "admin")

    // Create an attachment with filename "notes.txt" which will be assigned mimeType "text/plain"
    // The mediaTypeAttachments composition only accepts 'image/jpeg' per @Core.AcceptableMediaTypes annotation
    const responseCreate = await POST(
      `/odata/v4/admin/Incidents(${incidentID})/mediaTypeAttachments`,
      { filename: "notes.txt" },
      { headers: { "Content-Type": "application/json" } },
    )

    expect(responseCreate.status).toEqual(201)
    expect(responseCreate.data.ID).toBeTruthy()

    // The mimeType should be determined from the filename extension (text/plain for .txt)
    // not from what the user provides
    const attachmentID = responseCreate.data.ID

    // Verify the mimeType was set from filename, not from user input
    const getResponse = await GET(
      `/odata/v4/admin/Incidents(${incidentID})/mediaTypeAttachments(up__ID=${incidentID},ID=${attachmentID})`,
    )
    expect(getResponse.data.mimeType).toEqual("text/plain")

    // Now try to upload content with a different Content-Type header
    // Simulating an attacker intercepting the request and changing Content-Type to text/html
    // This should fail because the mimeType (text/plain) doesn't match allowed types (image/jpeg)
    const fileContent = Buffer.from("This is plain text content")

    let expectedError
    await PUT(
      `/odata/v4/admin/Incidents(${incidentID})/mediaTypeAttachments(up__ID=${incidentID},ID=${attachmentID})/content`,
      fileContent,
      {
        headers: {
          // Attacker intercepts and changes Content-Type, hoping to bypass validation
          "Content-Type": "text/html",
          "Content-Length": fileContent.length,
        },
      },
    ).catch((e) => {
      expectedError = e
    })

    // The upload should be rejected because:
    // 1. The mimeType is determined by filename extension (text/plain), not Content-Type header
    // 2. text/plain is not in the allowed list (image/jpeg) for mediaTypeAttachments
    expect(expectedError).toBeDefined()
    expect(expectedError.status).toEqual(400)
    expect(expectedError.response.data.error.message).toContain(
      "text/plain",
    )
  })

  /**
   * Security Test: MimeType Override in Request Body Attack
   *
   * This test validates that users cannot bypass mimetype restrictions
   * by manually setting mimeType in the POST request body.
   *
   * Attack scenario:
   * 1. User creates attachment with filename "document.txt"
   * 2. User also sends mimeType: "image/jpeg" in request body (trying to override)
   * 3. System should ignore user-provided mimeType and use extension-based detection
   * 4. mimeType should be "text/plain" (from .txt extension)
   * 5. Upload should fail because text/plain is not in allowed list (image/jpeg)
   */
  it("should reject upload when mimeType is manually overwritten in request body during content upload", async () => {
    const incidentID = await newIncident(POST, "admin")

    // Create an attachment with .txt extension -> mimeType will be text/plain
    const responseCreate = await POST(
      `/odata/v4/admin/Incidents(${incidentID})/mediaTypeAttachments`,
      { 
        filename: "document.txt",
        // Attacker tries to set mimeType directly (should be ignored)
        mimeType: "image/jpeg"
      },
      { headers: { "Content-Type": "application/json" } },
    )

    expect(responseCreate.status).toEqual(201)

    const attachmentID = responseCreate.data.ID

    // Verify mimeType was derived from filename, not from user input
    const getResponse = await GET(
      `/odata/v4/admin/Incidents(${incidentID})/mediaTypeAttachments(up__ID=${incidentID},ID=${attachmentID})`,
    )
    // The mimeType should be text/plain (from .txt extension), 
    // NOT image/jpeg (what attacker tried to set)
    expect(getResponse.data.mimeType).toEqual("text/plain")

    // Try to upload content - should fail because text/plain is not allowed
    const fileContent = Buffer.from("Plain text content")

    let expectedError
    await PUT(
      `/odata/v4/admin/Incidents(${incidentID})/mediaTypeAttachments(up__ID=${incidentID},ID=${attachmentID})/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": fileContent.length,
        },
      },
    ).catch((e) => {
      expectedError = e
    })

    expect(expectedError).toBeDefined()
    expect(expectedError.status).toEqual(400)
  })

  it("should allow upload when file extension matches allowed mimetypes", async () => {
    // Positive test: uploading a .jpg file to mediaTypeAttachments should succeed
    // because image/jpeg is in the allowed list

    const incidentID = await newIncident(POST, "admin")

    const responseCreate = await POST(
      `/odata/v4/admin/Incidents(${incidentID})/mediaTypeAttachments`,
      { filename: "photo.jpg" },
      { headers: { "Content-Type": "application/json" } },
    )

    expect(responseCreate.status).toEqual(201)
    const attachmentID = responseCreate.data.ID

    // Verify mimeType is image/jpeg (from .jpg extension)
    const getResponse = await GET(
      `/odata/v4/admin/Incidents(${incidentID})/mediaTypeAttachments(up__ID=${incidentID},ID=${attachmentID})`,
    )
    expect(getResponse.data.mimeType).toEqual("image/jpeg")

    // Upload actual JPEG content - should succeed
    const fileContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )

    const response = await PUT(
      `/odata/v4/admin/Incidents(${incidentID})/mediaTypeAttachments(up__ID=${incidentID},ID=${attachmentID})/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": fileContent.length,
        },
      },
    )

    expect(response.status).toEqual(204)
  })

  /**
   * Security Test: PDF Upload with Spoofed JPEG Content-Type
   *
   * This test validates protection against uploading disallowed file types
   * by spoofing the Content-Type header.
   *
   * Attack scenario:
   * 1. User creates attachment with filename "document.pdf"
   * 2. System assigns mimeType "application/pdf" based on file extension
   * 3. mediaTypeAttachments only allows 'image/jpeg'
   * 4. Attacker sends actual PDF content but with Content-Type: image/jpeg header
   * 5. System should reject based on database mimeType (application/pdf), not header
   */
  it("should reject PDF upload to jpeg-only attachment field even with spoofed Content-Type", async () => {
    const incidentID = await newIncident(POST, "admin")

    // Create attachment with .pdf extension -> mimeType will be application/pdf
    const responseCreate = await POST(
      `/odata/v4/admin/Incidents(${incidentID})/mediaTypeAttachments`,
      { filename: "document.pdf" },
      { headers: { "Content-Type": "application/json" } },
    )

    expect(responseCreate.status).toEqual(201)
    const attachmentID = responseCreate.data.ID

    // Verify mimeType is application/pdf
    const getResponse = await GET(
      `/odata/v4/admin/Incidents(${incidentID})/mediaTypeAttachments(up__ID=${incidentID},ID=${attachmentID})`,
    )
    expect(getResponse.data.mimeType).toEqual("application/pdf")

    // Try to upload with spoofed Content-Type: image/jpeg
    const pdfContent = readFileSync(
      join(__dirname, "..", "integration", "content/sample.pdf"),
    )

    let expectedError
    await PUT(
      `/odata/v4/admin/Incidents(${incidentID})/mediaTypeAttachments(up__ID=${incidentID},ID=${attachmentID})/content`,
      pdfContent,
      {
        headers: {
          // Spoofing Content-Type header to bypass validation
          "Content-Type": "image/jpeg",
          "Content-Length": pdfContent.length,
        },
      },
    ).catch((e) => {
      expectedError = e
    })

    // Upload should be rejected because mimeType (application/pdf) is not allowed
    expect(expectedError).toBeDefined()
    expect(expectedError.status).toEqual(400)
    expect(expectedError.response.data.error.message).toContain(
      "application/pdf",
    )
  })
})

describe("validateAttachmentMimeType - Unit tests", () => {
  it("should return false when target is not an attachments entity", () => {
    const req = {
      target: { _attachments: { isAttachmentsEntity: false } },
      data: { content: "test" },
      reject: jest.fn(),
    }
    
    const result = validateAttachmentMimeType(req)
    
    expect(result).toBe(false)
    expect(req.reject).not.toHaveBeenCalled()
  })

  it("should return false when there is no content", () => {
    const req = {
      target: { _attachments: { isAttachmentsEntity: true } },
      data: {},
      reject: jest.fn(),
    }
    
    const result = validateAttachmentMimeType(req)
    
    expect(result).toBe(false)
    expect(req.reject).not.toHaveBeenCalled()
  })

  it("should reject when mimeType does not match acceptable media types", () => {
    const req = {
      target: {
        _attachments: { isAttachmentsEntity: true },
        elements: {
          content: {
            "@Core.AcceptableMediaTypes": ["image/jpeg", "image/png"],
          },
        },
      },
      data: {
        content: "test content",
        mimeType: "text/plain",
      },
      reject: jest.fn(),
    }
    
    const result = validateAttachmentMimeType(req)
    
    expect(result).toBe(false)
    expect(req.reject).toHaveBeenCalledWith(400, "AttachmentMimeTypeDisallowed", {
      mimeType: "text/plain",
    })
  })

  it("should return true when mimeType matches acceptable media types", () => {
    const req = {
      target: {
        _attachments: { isAttachmentsEntity: true },
        elements: {
          content: {
            "@Core.AcceptableMediaTypes": ["image/jpeg", "image/png"],
          },
        },
      },
      data: {
        content: "test content",
        mimeType: "image/jpeg",
      },
      reject: jest.fn(),
    }
    
    const result = validateAttachmentMimeType(req)
    
    expect(result).toBe(true)
    expect(req.reject).not.toHaveBeenCalled()
  })

  it("should allow any mimeType when @Core.AcceptableMediaTypes is not defined (defaults to */*)", () => {
    const req = {
      target: {
        _attachments: { isAttachmentsEntity: true },
        elements: {
          content: {},
        },
      },
      data: {
        content: "test content",
        mimeType: "application/pdf",
      },
      reject: jest.fn(),
    }
    
    const result = validateAttachmentMimeType(req)
    
    expect(result).toBe(true)
    expect(req.reject).not.toHaveBeenCalled()
  })
})
