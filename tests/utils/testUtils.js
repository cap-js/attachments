const fs = require("fs")
const path = require("path")
const { createReadStream } = require("@sap/cds").utils.fs
const { join } = require("@sap/cds").utils.path
/**
 * Creates attachment metadata for non-draft mode
 * @param {Object} axios - Axios instance
 * @param {string} incidentId - Incident ID
 * @param {string} filename - Filename for the attachment
 * @returns {Promise<string>} - Attachment ID
 */
async function createAttachmentMetadata(axios, incidentId, filename = "sample.pdf") {
  const response = await axios.post(
    `/odata/v4/processor/Incidents(${incidentId})/attachments`,
    { filename: filename },
    { headers: { "Content-Type": "application/json" } }
  )
  return response.data.ID
}

/**
 * Uploads attachment content for non-draft mode
 * @param {Object} axios - Axios instance
 * @param {string} incidentId - Incident ID
 * @param {string} attachmentId - Attachment ID
 * @param {string} contentPath - Path to content file
 * @returns {Promise<Object>} - Axios response
 */
async function uploadAttachmentContent(axios, incidentId, attachmentId, contentPath = 'content/sample.pdf') {
  const fileContent = fs.readFileSync(path.join(__dirname, '..', 'integration', contentPath))
  const response = await axios.put(
    `/odata/v4/processor/Incidents(${incidentId})/attachments(up__ID=${incidentId},ID=${attachmentId})/content`,
    fileContent,
    {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": fileContent.length
      }
    }
  )
  return response
}

/**
 * Uploads attachment in draft mode using CDS test utilities
 * @param {Object} utils - RequestSend utility instance
 * @param {Object} POST - CDS test POST function
 * @param {Object} GET - CDS test GET function
 * @param {string} incidentId - Incident ID
 * @param {string} filename - Filename for the attachment
 * @returns {Promise<string>} - Attachment ID
 */
async function uploadDraftAttachment(utils, POST, GET, incidentId, filename = "sample.pdf") {
  const action = await POST.bind(
    {},
    `odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=false)/attachments`,
    {
      up__ID: incidentId,
      filename: filename,
      mimeType: "application/pdf",
      content: createReadStream(join(__dirname, "..", "integration", "content/sample.pdf")),
      createdAt: new Date(
        Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
      ),
      createdBy: "alice",
    }
  )

  await utils.draftModeActions(
    "processor",
    "Incidents",
    incidentId,
    "ProcessorService",
    action
  )

  // Get the uploaded attachment ID
  const response = await GET(
    `odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=true)/attachments`
  )
  return response.data.value[0]?.ID
}

/**
 * Cleans up attachments for an incident in non-draft mode
 * @param {Object} axios - Axios instance
 * @param {string} incidentId - Incident ID
 */
async function cleanupNonDraftAttachments(axios, incidentId) {
  try {
    const response = await axios.get(`/odata/v4/processor/Incidents(ID=${incidentId})/attachments`)
    for (const attachment of response.data.value) {
      try {
        await axios.delete(
          `/odata/v4/processor/Incidents(ID=${incidentId})/attachments(up__ID=${incidentId},ID=${attachment.ID})`
        )
      } catch (err) {
        // Ignore individual deletion errors
      }
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

/**
 * Cleans up attachments for an incident in draft mode
 * @param {Object} utils - RequestSend utility instance
 * @param {Object} GET - CDS test GET function
 * @param {Object} DELETE - CDS test DELETE function
 * @param {string} incidentId - Incident ID
 */
async function cleanupDraftAttachments(utils, GET, DELETE, incidentId) {
  try {
    const response = await GET(
      `odata/v4/processor/Incidents(ID=${incidentId},IsActiveEntity=true)/attachments`
    )
    
    for (const attachment of response.data.value) {
      try {
        const deleteAction = await DELETE.bind(
          {},
          `odata/v4/processor/Incidents_attachments(up__ID=${incidentId},ID=${attachment.ID},IsActiveEntity=false)`
        )
        await utils.draftModeActions(
          "processor",
          "Incidents",
          incidentId,
          "ProcessorService",
          deleteAction
        )
      } catch (err) {
        // Ignore individual deletion errors
      }
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

/**
 * Waits for attachment scanning to complete
 * @param {number} timeout - Timeout in milliseconds (default: 5000)
 * @returns {Promise<void>}
 */
async function waitForScanning(timeout = 5000) {
  return new Promise(resolve => setTimeout(resolve, timeout))
}

/**
 * Validates attachment response structure
 * @param {Object} attachment - Attachment object from API response
 * @param {string} expectedFilename - Expected filename
 * @param {string} expectedStatus - Expected status
 * @param {string} incidentId - Expected incident ID
 */
function validateAttachmentStructure(attachment, expectedFilename, expectedStatus, incidentId) {
  if (attachment.up__ID !== incidentId) {
    throw new Error(`Expected up__ID to be ${incidentId}, got ${attachment.up__ID}`)
  }
  if (attachment.filename !== expectedFilename) {
    throw new Error(`Expected filename to be ${expectedFilename}, got ${attachment.filename}`)
  }
  if (attachment.status !== expectedStatus) {
    throw new Error(`Expected status to be ${expectedStatus}, got ${attachment.status}`)
  }
  if (attachment.content !== undefined) {
    throw new Error("Content should not be included in list responses")
  }
}

module.exports = {
  createAttachmentMetadata,
  uploadAttachmentContent,
  uploadDraftAttachment,
  cleanupNonDraftAttachments,
  cleanupDraftAttachments,
  waitForScanning,
  validateAttachmentStructure
}
