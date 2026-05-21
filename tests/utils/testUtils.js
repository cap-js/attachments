const cds = require("@sap/cds")

/**
 * Waits for attachment scanning to complete
 * @param {number} timeout - Timeout in milliseconds (default: 5000)
 * @returns {Promise<void>}
 */
async function delay(timeout = 1000) {
  return new Promise((resolve) => setTimeout(resolve, timeout))
}

async function waitForScanStatus(status, attachmentID) {
  const db = await cds.connect.to("db")
  let latestStatus = null
  return Promise.race([
    new Promise((resolve) => {
      let resolved = false
      const handler = (_res, req) => {
        // Skip if already resolved to prevent memory buildup
        if (resolved) return

        if (req.event !== "UPDATE") return

        const data = req.query?.UPDATE?.data
        if (!data) return

        // Find the status field: either 'status' (composition attachments)
        // or '<prefix>_status' (inline single attachments)
        const statusKey = Object.keys(data).find(
          (k) => k === "status" || k.endsWith("_status"),
        )
        if (!statusKey) return

        // Match target: either a composition attachment entity or any entity
        // with inline attachment fields (identified by having a prefixed _status field)
        const isAttachmentsTarget =
          req.target.name.includes(".attachments") ||
          statusKey.includes("_status")
        if (!isAttachmentsTarget) return

        // Filter by attachmentID if provided
        if (
          attachmentID &&
          !(
            (req.query.UPDATE.entity?.ref?.at(-1)?.where &&
              req.query.UPDATE.entity.ref
                .at(-1)
                .where.some((e) => e.val && e.val === attachmentID)) ||
            (req.query.UPDATE.where &&
              req.query.UPDATE.where.some(
                (e) =>
                  (e.val && e.val === attachmentID) ||
                  (e.xpr && e.xpr.some((e) => e.val && e.val === attachmentID)),
              ))
          )
        )
          return

        latestStatus = data[statusKey]

        if (data[statusKey] === status) {
          resolved = true
          resolve(req.query.UPDATE.where || req.query.UPDATE.entity?.ref)
        }
      }
      db.after("*", handler)
    }),
    delay(40000).then(async () => {
      const { messagesAmount } = await SELECT.one
        .from("cds.outbox.Messages")
        .columns("count(1) as messagesAmount")
      throw new Error(
        `Timeout waiting for attachment ${attachmentID || ""} to reach status: ${status}, last known status: ${latestStatus}. ${messagesAmount} messages in outbox.`,
      )
    }),
  ])
}

/**
 * Waits for deletion of attachment with given ID
 * @param {string} attachmentID - The attachment ID to wait for deletion
 * @returns {Promise<boolean>} - Resolves to true when deletion is detected
 */
async function waitForDeletion(attachmentID) {
  const AttachmentsSrv = await cds.connect.to("attachments")
  return Promise.race([
    new Promise((resolve) => {
      let resolved = false
      const handler = (req) => {
        if (resolved) return

        if (req.data?.url == attachmentID) {
          resolved = true
          resolve(true)
        }
      }
      AttachmentsSrv.on("DeleteAttachment", handler)
    }),
    delay(30000).then(async () => {
      const { messagesAmount } = await SELECT.one
        .from("cds.outbox.Messages")
        .columns("count(1) as messagesAmount")
      throw new Error(
        `Timeout waiting for deletion of attachment ID: ${attachmentID}. ${messagesAmount} messages in outbox.`,
      )
    }),
  ])
}

/**
 * Waits for malware deletion of attachment with given ID
 * @param {string} attachmentID - The attachment ID to wait for deletion
 * @returns {Promise<boolean>} - Resolves to true when deletion is detected
 */
async function waitForMalwareDeletion(attachmentID) {
  const AttachmentsSrv = await cds.connect.to("attachments")

  return Promise.race([
    new Promise((resolve) => {
      let resolved = false
      const handler = async (req) => {
        if (resolved) return

        const { keys } = req.data

        if (keys?.ID == attachmentID) {
          resolved = true
          resolve(true)
        }
      }
      AttachmentsSrv.on("DeleteInfectedAttachment", handler)
    }),
    delay(30000).then(async () => {
      const { messagesAmount } = await SELECT.one
        .from("cds.outbox.Messages")
        .columns("count(1) as messagesAmount")
      throw new Error(
        `Timeout waiting for malware deletion of attachment ID: ${attachmentID}. ${messagesAmount} messages in outbox.`,
      )
    }),
  ])
}

/**
 *
 * @returns Incident ID
 */
async function newIncident(
  POST,
  serviceName,
  payload = {
    title: `Incident ${Math.floor(Math.random() * 1000)}`,
    customer_ID: "1004155",
  },
  entity = "Incidents",
) {
  try {
    // Create draft from active entity
    const res = await POST(`odata/v4/${serviceName}/${entity}`, payload)
    return res.data.ID
  } catch (err) {
    return err
  }
}

async function runWithUser(user, fn) {
  const ctx = cds.EventContext.for({
    id: cds.utils.uuid(),
    http: { req: null, res: null },
  })
  ctx.user = user
  return cds._with(ctx, fn)
}

module.exports = {
  delay,
  waitForScanStatus,
  newIncident,
  waitForDeletion,
  waitForMalwareDeletion,
  runWithUser,
}
