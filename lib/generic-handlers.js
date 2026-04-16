const cds = require("@sap/cds")
const LOG = cds.log("attachments")
const { extname } = require("path")
const {
  MAX_FILE_SIZE,
  sizeInBytes,
  checkMimeTypeMatch,
  inferTargetCAP8,
} = require("./helper")
const { getMime } = require("./mime")

/**
 * Finalizes the preparation of a single attachment's data
 * @param {object} data - The attachment data
 * @param {import('@sap/cds').Request} req - The request object
 */
async function finalizePrepareAttachment(data, req, prefix) {
  const attachmentData = prefix ? {} : data
  if (prefix) {
    for (const key in data) {
      if (key.startsWith(prefix)) {
        attachmentData[key.substring(prefix.length + 1)] = data[key]
      }
    }
  }

  if (req?.data === data && "url" in attachmentData) {
    delete attachmentData.url
  }

  const hasUpKey = Object.keys(attachmentData).some((key) =>
    key.startsWith("up__"),
  )

  if (!hasUpKey) {
    const parentRef = req.subject.ref.slice(0, -1)

    // Only try to populate parent keys if there is a parent reference
    if (parentRef && parentRef.length > 0) {
      let target
      if (cds.infer?.target) {
        // CAP 9+: Use cds.infer.target
        target = cds.infer.target({ SELECT: { from: { ref: parentRef } } })
      } else {
        // CAP 8 fallback: Use inferTargetCAP8 helper
        target = inferTargetCAP8(req, parentRef)
      }

      if (target?.keys) {
        LOG.info(`Populating parent keys for attachment upload`, target)
        const parentKeys = Object.keys(target.keys)
        const parentRecord = await SELECT.one
          .from({ ref: parentRef })
          .columns(parentKeys)

        for (const key of parentKeys) {
          attachmentData[`up__${key}`] = parentRecord[key]
        }
      } else {
        LOG.warn(
          `Could not determine parent target for attachment upload. ParentRef: ${JSON.stringify(parentRef)}`,
        )
      }
    }
  }

  if (!data.url) {
    const attachment = await cds.connect.to("attachments")
    // Generate URL for object store
    data.url = await attachment.createUrlForAttachment(data)
  }
  attachmentData.ID ??= cds.utils.uuid()

  let ext = attachmentData.filename
    ? extname(attachmentData.filename).toLowerCase().slice(1)
    : null
  attachmentData.mimeType = getMime(ext)

  if (!attachmentData.mimeType) {
    LOG.warn(
      `An attachment ${attachmentData.ID} is uploaded whose extension "${ext}" is not known! Falling back to "application/octet-stream"`,
    )
    attachmentData.mimeType = "application/octet-stream"
  }

  if (prefix) {
    for (const key in attachmentData) {
      data[`${prefix}_${key}`] = attachmentData[key]
    }
  }
}

/**
 * Traverses the composition path to prepare attachment data
 * @param {object} data - The attachment data
 * @param {Array} comps - The composition path for a single attachment entity
 * @param {import('@sap/cds').Request} req - The request object
 */
async function traverseReqData(data, comps, req) {
  if (comps.length === 0 || !data[comps[0]]) return
  if (comps.length === 1) {
    for (const dataItem of data[comps[0]]) {
      await finalizePrepareAttachment(dataItem, req)
    }
    return
  }
  if (data[comps[0]] instanceof Array) {
    for (const dataItem of data[comps[0]]) {
      await traverseReqData(dataItem, comps.slice(1), req)
    }
  } else {
    await traverseReqData(data[comps[0]], comps.slice(1), req)
  }
}

/**
 * Prepares the attachment data before creation
 * @param {import('@sap/cds').Request} req - The request object
 */
async function onPrepareAttachment(req) {
  if (
    !req.target?._attachments.isAttachmentsEntity &&
    !req.target?._attachments.hasAttachmentsComposition &&
    !req.target?._attachments.hasInlineAttachments
  )
    return

  if (req.target?._attachments.isAttachmentsEntity) {
    await finalizePrepareAttachment(req.data, req)
  } else {
    if (req.target?._attachments.hasAttachmentsComposition) {
      const attachmentCompositions =
        req?.target?._attachments.attachmentCompositions
      for (const attachmentsComp of attachmentCompositions) {
        await traverseReqData(req.data, attachmentsComp, req)
      }
    }
    if (req.target?._attachments.hasInlineAttachments) {
      for (const prefix of req.target?._attachments.inlineAttachmentPrefixes ?? []) {
        if (req.data[`${prefix}_content`]) {
          await finalizePrepareAttachment(req.data, req, prefix)
        }
      }
    }
  }
}

/**
 * Validates if the attachment can be accessed based on its malware scan status
 * @param {import('@sap/cds').Request} req - The request object
 */
async function validateAttachment(req) {
  if (
    !req.target?._attachments.isAttachmentsEntity &&
    !req.target?._attachments.hasInlineAttachments
  )
    return

  /* removing case condition for mediaType annotation as in our case binary value and metadata is stored in different database */
  if (req.target?._attachments.isAttachmentsEntity) {
    req?.query?.SELECT?.columns?.forEach((element) => {
      if (element.as === "content@odata.mediaContentType" && element.xpr) {
        delete element.xpr
        element.ref = ["mimeType"]
      }
    })
  }

  const reqUrl = req?.req?.url
  const isContentRequest =
    reqUrl?.endsWith("/content") || /\/[^/]*_content$/.test(reqUrl)

  if (isContentRequest) {
    const AttachmentsSrv = await cds.connect.to("attachments")

    let status, lastScan, attachmentId, target, keys

    if (req.target?._attachments.isAttachmentsEntity) {
      ;({ status, lastScan } = await AttachmentsSrv.getStatus(req.target, {
        ID: req.data.ID || req.params?.at(-1).ID,
      }))

      attachmentId = req.data.ID || req.params?.at(-1).ID
      target = req.target.name
      keys = { ID: attachmentId }
    } else {
      const prefix = reqUrl.split("/").pop().replace("_content", "")
      const { IsActiveEntity: _ia, ...dbKeys } = Object.fromEntries(
        Object.entries(req.target.keys)
          .map(([key]) => [
            key,
            req.data[key] || req.params.find((p) => p[key])?.[key],
          ])
          .filter(([, value]) => value !== undefined),
      )

      const parentRecord = await SELECT.one
        .from(req.target, dbKeys)
        .columns(`${prefix}_status`, `${prefix}_lastScan`)
      if (!parentRecord) return req.reject(404)

      status = parentRecord[`${prefix}_status`]
      lastScan = parentRecord[`${prefix}_lastScan`]
      attachmentId = dbKeys.ID
      target = req.target
      keys = dbKeys
    }

    if (status === null || status === undefined) {
      return req.reject(404)
    }

    const scanEnabled = cds.env.requires?.attachments?.scan ?? true

    if (scanEnabled) {
      const scanExpiryMs =
        cds.env.requires?.attachments?.scanExpiryMs ?? 3 * 24 * 60 * 60 * 1000

      if (status !== "Clean") {
        const ipAddress = req.req?.socket?.remoteAddress
        cds.spawn(async () => {
          try {
            const srv = await cds.connect.to("attachments")
            await srv.emit("AttachmentDownloadRejected", {
              target: req.target.name,
              keys: { ID: attachmentId },
              status,
              ipAddress,
            })
          } catch (err) {
            LOG.error("Failed to emit AttachmentDownloadRejected", err)
          }
        })
        req.reject(403, "UnableToDownloadAttachmentScanStatusNotClean")
      }

      if (
        scanExpiryMs !== -1 &&
        (!lastScan || Date.now() - new Date(lastScan).getTime() > scanExpiryMs)
      ) {
        LOG.debug(
          `Attachment ${attachmentId} scan has expired or no lastScan date. Triggering re-scan.`,
        )

        // No scan or scan expired: trigger scan and reject
        const malwareScanner = await cds.connect.to("malwareScanner")

        // Set status to Scanning and commit before emitting event to prevent race conditions
        if (req.target?._attachments.isAttachmentsEntity) {
          cds.tx(
            async () =>
              await malwareScanner.updateStatus(target, keys, "Scanning"),
          )
          cds.spawn(
            async () =>
              await malwareScanner.emit("ScanAttachmentsFile", {
                target,
                keys,
              }),
          )
        } else {
          const prefix = reqUrl.split("/").pop().replace("_content", "")
          cds.tx(
            async () =>
              await UPDATE(req.target, keys).set({
                [`${prefix}_status`]: "Scanning",
              }),
          )
          cds.spawn(
            async () =>
              await malwareScanner.emit("ScanAttachmentsFile", {
                target: req.target.name,
                keys,
              }),
          )
        }

        // req.reject does not accept status codes below 400, so we throw the error directly
        throw cds.error({
          status: 202,
          code: "UnableToDownloadAttachmentScanStatusExpired",
        })
      }
    }
  }
}

/**
 * Reads the attachment content if requested
 * @param {[import('@sap/cds').Entity]} param0
 * @param {import('@sap/cds').Request} req - The request object
 */
async function readAttachment([attachment], req) {
  if (
    !req.target?._attachments.isAttachmentsEntity &&
    !req.target?._attachments.hasInlineAttachments
  )
    return

  if (
    req._.readAfterWrite ||
    !req?.req?.url?.endsWith("/content") ||
    !attachment
  )
    return

  const AttachmentsSrv = await cds.connect.to("attachments")

  let keys, target

  if (req.target?._attachments.isAttachmentsEntity) {
    if (attachment.content) return
    keys = { ID: req.data.ID ?? req.params.at(-1).ID }
    target = req.target
  } else {
    const prefix = req.params.at(-1).split("_")[0]
    const contentField = `${prefix}_content`
    if (attachment[contentField]) return
    const parentKeys = Object.fromEntries(
      Object.entries(req.target.keys).map(([key]) => [key, attachment[key]]),
    )
    const record = await SELECT.one
      .from(req.target, parentKeys)
      .columns(`${prefix}_ID as ID`)
    if (!record?.ID) return
    keys = { ID: record.ID }
    target = req.target.elements[prefix]._target
  }

  attachment.content = await AttachmentsSrv.get(target, keys)
}

/**
 * Checks the attachments size against the maximum defined by the annotation `@Validation.Maximum`. Default 400mb.
 * If the limit is reached by the reported size of the content-length header or if the stream length exceeds
 * the limits the error is thrown.
 * @param {import('@sap/cds').Request} req - The request object
 * @throws AttachmentSizeExceeded
 */
async function validateAttachmentSize(req, validateContentLength = false) {
  if (
    !req.target?._attachments.isAttachmentsEntity &&
    !req.target?._attachments.hasInlineAttachments
  )
    return false

  let element, content, prefix
  if (req.target?._attachments.isAttachmentsEntity) {
    element = req.target.elements.content
    content = req.data.content ?? req.req?.body?.content
  } else {
    prefix = req.target?._attachments.inlineAttachmentPrefixes.find(
      (p) =>
        req.data[`${p}_content`] ||
        req.headers["content-disposition"]?.includes(`name="${p}_content"`),
    )
    if (!prefix) return false

    element = req.target.elements[`${prefix}_content`]
    content = req.data[`${prefix}_content`]
  }

  if (!content && !validateContentLength) return false

  const maxFileSize = element["@Validation.Maximum"]
    ? (sizeInBytes(element["@Validation.Maximum"], req.target.name) ??
      MAX_FILE_SIZE)
    : MAX_FILE_SIZE

  const isInMemory = content != null && typeof content.length === "number"

  if (!validateContentLength && !isInMemory) {
    if (
      req.headers["content-length"] == null ||
      req.headers["content-length"] === ""
    ) {
      return true
    }

    if (isNaN(Number(req.headers["content-length"]))) {
      req.reject(400, "InvalidContentLengthHeader", {
        contentLength: req.headers["content-length"],
      })
      return false
    }
  }

  const length =
    validateContentLength || isInMemory
      ? content.length
      : Number(req.headers["content-length"])

  if (length > maxFileSize) {
    if (content?.pause) {
      content.pause()
    }

    let filename
    if (req.target?._attachments.isAttachmentsEntity) {
      const attachmentId = req.data.ID ?? req.params?.at(-1)?.ID
      const attachmentRef = attachmentId
        ? await SELECT.one("filename")
            .from(req.target)
            .where({ ID: attachmentId })
        : null
      filename = req.data.filename ?? attachmentRef?.filename ?? "n/a"
    } else {
      filename = req.data[`${prefix}_filename`] ?? null
      if (!filename) {
        const { IsActiveEntity: _ia, ...dbKeys } = req.params?.at(-1) || {}
        const record = await SELECT.one
          .from(req.target.drafts || req.target, dbKeys)
          .columns(`${prefix}_filename`)
        filename = record?.[`${prefix}_filename`] ?? "n/a"
      }
    }

    const ipAddress = req.req?.socket?.remoteAddress
    cds.spawn(async () => {
      try {
        const AttachmentsSrv = await cds.connect.to("attachments")
        await AttachmentsSrv.emit("AttachmentSizeExceeded", {
          target: req.target.name,
          keys: req.data.ID ? { ID: req.data.ID } : {},
          filename,
          fileSize: length,
          maxFileSize,
          ipAddress,
        })
      } catch (err) {
        LOG.error("Failed to emit AttachmentSizeExceeded", err)
      }
    })

    req.reject({
      status: 413,
      message: "AttachmentSizeExceeded",
      args: [filename, element["@Validation.Maximum"] ?? "400MB"],
    })
    return false
  }
  return true
}

/**
 * Validates the attachment mime type against acceptable media types
 * @param {import('@sap/cds').Request} req - The request object
 */
function validateAttachmentMimeType(req) {
  if (
    !req.target?._attachments.isAttachmentsEntity &&
    !req.target?._attachments.hasInlineAttachments
  )
    return false

  let mimeType, element
  if (req.target?._attachments.isAttachmentsEntity) {
    if (!req.data.content) return false
    element = req.target.elements.content
    mimeType = req.data.mimeType
  } else {
    const prefix = req.target?._attachments.inlineAttachmentPrefixes.find(
      (p) =>
        req.data[`${p}_content`] ||
        req.headers["content-disposition"]?.includes(`name="${p}_content"`),
    )
    if (!prefix) return false

    element = req.target.elements[`${prefix}_content`]
    mimeType = req.data[`${prefix}_mimeType`]
  }

  const acceptableMediaTypes = element["@Core.AcceptableMediaTypes"] || "*/*"
  if (!checkMimeTypeMatch(acceptableMediaTypes, mimeType)) {
    const ipAddress = req.req?.socket?.remoteAddress
    cds.spawn(async () => {
      try {
        const AttachmentsSrv = await cds.connect.to("attachments")
        await AttachmentsSrv.emit("AttachmentUploadRejected", {
          target: req.target.name,
          keys: req.data.ID ? { ID: req.data.ID } : {},
          filename: req.data.filename,
          mimeType,
          acceptableMediaTypes,
          reason: `MIME type '${mimeType}' is not in @Core.AcceptableMediaTypes`,
          ipAddress,
        })
      } catch (err) {
        LOG.error("Failed to emit AttachmentUploadRejected", err)
      }
    })
    req.reject(400, "AttachmentMimeTypeDisallowed", {
      mimeType: mimeType,
    })
    return false
  }
  return true
}

async function validateAndInsertAttachmentFromDBHandler(data, target, req) {
  if (!target._attachments) return

  if (target._attachments.isAttachmentsEntity) {
    if (!data.content) return
    if (!validateAttachmentMimeType({ data, target, reject: req.reject }))
      return
    if (
      !(await validateAttachmentSize(
        { data, target, reject: req.reject },
        true,
      ))
    )
      return

    data.url = cds.utils.uuid()
    const attachment = await cds.connect.to("attachments")
    await attachment.put(target, data)
  } else if (target._attachments.hasInlineAttachments) {
    for (const prefix of target._attachments.inlineAttachmentPrefixes) {
      if (data[`${prefix}_content`]) {
        const attachmentData = {
          content: data[`${prefix}_content`],
          mimeType: data[`${prefix}_mimeType`],
          filename: data[`${prefix}_filename`],
        }

        const attachmentTarget =
          cds.model.definitions["sap.attachments.Attachment"]
        if (
          !validateAttachmentMimeType({
            data: attachmentData,
            target: attachmentTarget,
            reject: req.reject,
          })
        )
          continue
        if (
          !(await validateAttachmentSize(
            {
              data: attachmentData,
              target: attachmentTarget,
              reject: req.reject,
            },
            true,
          ))
        )
          continue

        data[`${prefix}_url`] = cds.utils.uuid()
        attachmentData.url = data[`${prefix}_url`]

        const attachmentService = await cds.connect.to("attachments")
        await attachmentService.put(attachmentTarget, attachmentData)
      }
    }
  }
}

module.exports = {
  validateAttachmentSize,
  onPrepareAttachment,
  readAttachment,
  validateAttachment,
  validateAttachmentMimeType,
  validateAndInsertAttachmentFromDBHandler,
}
