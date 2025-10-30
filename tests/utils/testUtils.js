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
    db.after('*', (res, req) => {
      if (
        req.event === 'UPDATE' && req.query.UPDATE.data.status &&
        req.query.UPDATE.data.status === status && req.target.name.includes('.attachments') &&
        (
          !attachmentID ||
          (req.query.UPDATE.entity.ref.at(-1).where && req.query.UPDATE.entity.ref.at(-1).where.some(e => e.val && e.val === attachmentID)) ||
          (req.query.UPDATE.where && req.query.UPDATE.where.some(e => e.val && e.val === attachmentID)))
      ) {
        resolve(req.query.UPDATE.where || req.query.UPDATE.entity.ref)
      }
    })
  })
}

module.exports = {
  delay, waitForScanStatus
}
