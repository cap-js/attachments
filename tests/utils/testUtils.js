const cds = require('@sap/cds')

/**
 * Waits for attachment scanning to complete
 * @param {number} timeout - Timeout in milliseconds (default: 5000)
 * @returns {Promise<void>}
 */
async function delay(timeout = 1000) {
  return new Promise(resolve => setTimeout(resolve, timeout))
}

async function waitForScanStatus(status, attachmentID) {
  const db = await cds.connect.to('db')
  return new Promise((resolve) => {
    let resolved = false
    const handler = (_res, req) => {
      // Skip if already resolved to prevent memory buildup
      if (resolved) return

      if (
        req.event === 'UPDATE' && req.query.UPDATE.data.status &&
        req.query.UPDATE.data.status === status && req.target.name.includes('.attachments') &&
        (
          !attachmentID ||
          (req.query.UPDATE.entity.ref.at(-1).where && req.query.UPDATE.entity.ref.at(-1).where.some(e => e.val && e.val === attachmentID)) ||
          (req.query.UPDATE.where && req.query.UPDATE.where.some(e => e.val && e.val === attachmentID)))
      ) {
        resolved = true
        resolve(req.query.UPDATE.where || req.query.UPDATE.entity.ref)
      }
    }
    db.after('*', handler)
  })
}

/**
 * Waits for deletion of attachment with given ID
 * @param {string} attachmentID - The attachment ID to wait for deletion
 * @returns {Promise<boolean>} - Resolves to true when deletion is detected
 */
async function waitForDeletion(attachmentID) {
  const AttachmentsSrv = await cds.connect.to("attachments")
  return new Promise(resolve => {
    let resolved = false
    const handler = (req) => {
      if (resolved) return

      if (req.data?.url == attachmentID) {
        resolved = true
        resolve(true)
      }
    }
    AttachmentsSrv.on('DeleteAttachment', handler)
  })
}


/**
 * 
 * @returns Incident ID
 */
async function newIncident(POST, serviceName, payload = {
  title: `Incident ${Math.floor(Math.random() * 1000)}`,
  customer_ID: '1004155'
}, entity = 'Incidents') {
  try {
    // Create draft from active entity
    const res = await POST(
      `odata/v4/${serviceName}/${entity}`,
      payload
    );
    return res.data.ID;
  } catch (err) {
    return err
  }
}

module.exports = {
  delay, waitForScanStatus, newIncident, waitForDeletion
}
