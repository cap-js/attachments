const cds = require('@sap/cds')
const LOG = cds.log('attachments')
const { computeHash } = require('../lib/helper')

class AttachmentsService extends cds.Service {

  init() {
    this.on('DeleteAttachment', async msg => {
      await this.delete(msg.data.url)
    })

    this.on('DeleteInfectedAttachment', async msg => {
      const { target, hash, keys } = msg.data
      const attachment = await SELECT.one.from(target).where(Object.assign({ hash }, keys)).columns('url')
      if (attachment) { //Might happen that a draft object is the target
        await this.delete(attachment.url)
      } else {
        LOG.warn(`Cannot delete malware file with the hash ${hash} for attachment ${target}, keys: ${keys}`)
      }
    })
    return super.init()
  }

  /**
   * Uploads attachments to the database and initiates malware scans for database-stored files
   * @param {cds.Entity} attachments - Attachments entity definition
   * @param {Array|Object} data - The attachment data to be uploaded
   * @returns {Promise<Array>} - Result of the upsert operation
   */
  async put(attachments, data) {
    if (!Array.isArray(data)) {
      data = [data]
    }

    LOG.debug('Starting database attachment upload', {
      attachmentEntity: attachments.name,
      fileCount: data.length,
      filenames: data.map((d) => d.filename || 'unknown'),
    })

    let res

    try {
      res = await Promise.all(
        data.map(async (d) => {
          const res = await UPSERT(d).into(attachments)
          const attachmentForHash = await this.get(attachments, { ID: d.ID })
          // If this is just the PUT for metadata, there is not yet any file to retrieve
          if (attachmentForHash) {
            const hash = await computeHash(attachmentForHash)
            await this.update(attachments, { ID: d.ID }, { hash })
          }
          return res
        })
      )

      LOG.debug('Attachment records upserted to database successfully', {
        attachmentEntity: attachments.name,
        recordCount: data.length
      })

    } catch (error) {
      LOG.error(
        'Failed to upsert attachment records to database', error,
        'Check database connectivity and attachment entity configuration',
        { attachmentEntity: attachments.name, recordCount: data.length, errorMessage: error.message })
      throw error
    }

    // Initiate malware scanning for database-stored files
    LOG.debug('Initiating malware scans for database-stored files', {
      fileCount: data.length,
      fileIds: data.map(d => d.ID)
    })

    const MalwareScanner = await cds.connect.to('malwareScanner')
    await Promise.all(
      data.map(async (d) => {
        await MalwareScanner.emit('ScanAttachmentsFile', { target: attachments.name, keys: { ID: d.ID } })
      })
    )

    return res
  }

  /**
   * Registers attachment handlers for the given service and entity
   * @param {cds.Entity} attachments - The attachment service instance
   * @param {string} keys - The keys to identify the attachment
   * @param {import('@sap/cds').Request} req - The request object
   * @returns {Buffer|Stream|null} - The content of the attachment or null if not found
   */
  async get(attachments, keys) {
    LOG.debug("Downloading attachment for", {
      attachmentName: attachments.name,
      attachmentKeys: keys
    })
    let result = await SELECT.from(attachments, keys).columns("content")
    if (!result && attachments.isDraft) {
      attachments = attachments.actives
      result = await SELECT.from(attachments, keys).columns("content")
    }
    return (result?.content) ? result.content : null
  }
  /**
   * Returns a handler to copy updated attachments content from draft to active / object store
   * @param {cds.Entity} attachments - Attachments entity definition
   * @returns {Function} - The draft save handler function
   */
  draftSaveHandler(attachments) {
    const queryFields = this.getFields(attachments)

    return async (_, req) => {
      // The below query loads the attachments into streams
      const cqn = SELECT(queryFields)
        .from(attachments.drafts)
        .where([
          ...req.subject.ref[0].where.map((x) =>
            x.ref ? { ref: ["up_", ...x.ref] } : x
          )
          // NOTE: needs skip LargeBinary fix to Lean Draft
        ])
      cqn.where({ content: { '!=': null } })
      const draftAttachments = await cqn

      if (draftAttachments.length)
        await this.put(attachments, draftAttachments)
    }
  }
  /**
   * Returns the fields to be selected from Attachments entity definition
   * including the association keys if Attachments entity definition is associated to another entity
   * @param {cds.Entity} attachments - Attachments entity definition
   * @returns {Array} - Array of fields to be selected
   */
  getFields(attachments) {
    const attachmentFields = ["filename", "mimeType", "content", "url", "ID"]
    const { up_ } = attachments.keys
    if (up_)
      return up_.keys
        .map((k) => "up__" + k.ref[0])
        .concat(...attachmentFields)
        .map((k) => ({ ref: [k] }))
    else return Object.keys(attachments.keys)
  }

  /**
   * Registers handlers for attachment entities in the service
   * @param {cds.Service} srv - The CDS service instance
   */
  registerHandlers(srv) {
    if (!cds.env.fiori.move_media_data_in_db) {
      srv.after("SAVE", async function saveDraftAttachments(res, req) {
        if (
          req.target.isDraft ||
          !req.target.drafts ||
          !req.target._attachments.hasAttachmentsComposition ||
          !req.target._attachments.attachmentCompositions
        ) {
          return
        }
        await Promise.all(
          Object.keys(req.target._attachments.attachmentCompositions).map(attachmentsEle =>
            this.draftSaveHandler(req.target.elements[attachmentsEle]._target)(res, req)
          )
        )
      }.bind(this))
    }
  }

  /**
   * Updates attachment metadata in the database
   * @param {cds.Entity} Attachments - Attachments entity definition
   * @param {string} key - The key of the attachment to update
   * @param {*} data - The data to update the attachment with
   * @returns {Promise} - Result of the update operation
   */
  async update(Attachments, key, data) {
    LOG.debug("Updating attachment for", {
      attachmentName: Attachments.name,
      attachmentKey: key
    })

    return await UPDATE(Attachments, key).with(data)
  }

  /**
   * Retrieves the malware scan status of an attachment
   * @param {cds.Entity} Attachments - Attachments entity definition
   * @param {string} key - The key of the attachment to retrieve the status for
   * @returns {string} - The malware scan status of the attachment
   */
  async getStatus(Attachments, key) {
    const result = await SELECT.from(Attachments, key).columns('status')
    return result?.status
  }



  /**
   * Registers attachment handlers for the given service and entity
   * @param {*} records - The records to process
   * @param {import('@sap/cds').Request} req - The request object
   */
  async deleteAttachmentsWithKeys(records, req) {
    req.attachmentsToDelete?.forEach(async (attachment) => {
      if (attachment.url) {
        const attachmentsSrv = await cds.connect.to('attachments')
        await attachmentsSrv.emit('DeleteAttachment', { url: attachment.url })
      } else {
        LOG.warn(`Attachment cannot be deleted because URL is missing`, attachment)
      }
    })
  }

  /**
   * Registers attachment handlers for the given service and entity
   * @param {import('@sap/cds').Request} req - The request object
   */
  async attachDeletionData(req) {
    const attachmentCompositions = Object.keys(req?.target?.associations)
      .filter(assoc => req?.target?.associations[assoc]._target['@_is_media_data'])
    if (attachmentCompositions.length > 0) {
      const diffData = await req.diff()
      if (!diffData || Object.keys(diffData).length === 0) {
        return
      }
      const queries = []
      for (const attachmentsComp of attachmentCompositions) {
        let deletedAttachments = []
        diffData[attachmentsComp]?.forEach(object => {
          if (object._op === "delete") {
            deletedAttachments.push(object.ID)
          }
        })
        if (deletedAttachments.length) {
          queries.push(
            SELECT.from(req.target.associations[attachmentsComp]._target).columns("url").where({ ID: { in: [...deletedAttachments] } })
          )
        }
      }
      if (queries.length > 0) {
        const attachmentsToDelete = (await Promise.all(queries)).flat()
        if (attachmentsToDelete.length > 0) {
          req.attachmentsToDelete = attachmentsToDelete
        }
      }
    }
  }

  /**
   * Registers attachment handlers for the given service and entity
   * @param {{draftEntity: string, activeEntity:cds.Entity, id:string}} param0 - The service and entities
   * @returns 
   */
  async getAttachmentsToDelete({ draftEntity, activeEntity, whereXpr }) {
    const [draftAttachments, activeAttachments] = await Promise.all([
      SELECT.from(draftEntity).columns("url").where(whereXpr),
      SELECT.from(activeEntity).columns("url").where(whereXpr)
    ])

    const activeUrls = new Set(activeAttachments.map(a => a.url))
    return draftAttachments
      .filter(({ url }) => !activeUrls.has(url))
      .map(({ url }) => ({ url }))
  }

  /**
   * Add draft attachment deletion data to the request
   * @param {import('@sap/cds').Request} req - The request object
   */
  async attachDraftDeletionData(req) {
    const draftEntity = cds.model.definitions[req?.target?.name]
    const name = req?.target?.name
    const activeEntity = name ? cds.model.definitions?.[name.split(".").slice(0, -1).join(".")] : undefined

    if (!draftEntity || !activeEntity) return

    const diff = await req.diff()
    if (diff._op !== "delete" || !diff.ID) return

    const attachmentsToDelete = await this.getAttachmentsToDelete({
      draftEntity,
      activeEntity,
      whereXpr: { ID: diff.ID }
    })

    if (attachmentsToDelete.length) {
      req.attachmentsToDelete = attachmentsToDelete
    }
  }

  /**
   * Add draft discard deletion data to the request
   * @param {import('@sap/cds').Request} req - The request object
   */
  async attachDraftDiscardDeletionData(req) {
    const parentEntity = req.target.name.split('.').slice(0, -1).join('.')
    const draftEntity = cds.model.definitions[`${parentEntity}.attachments.drafts`]
    const activeEntity = cds.model.definitions[`${parentEntity}.attachments`]
    if (!draftEntity || !activeEntity) return

    const whereXpr = []
    for (const foreignKey of activeEntity.keys['up_']._foreignKeys) {
      if (whereXpr.length) {
        whereXpr.push('and')
      }
      whereXpr.push(
        { ref: [foreignKey.parentElement.name] },
        '=',
        { val: req.data[foreignKey.childElement.name] }
      )
    }

    const attachmentsToDelete = await this.getAttachmentsToDelete({
      draftEntity,
      activeEntity,
      whereXpr
    })

    if (attachmentsToDelete.length > 0) {
      req.attachmentsToDelete = attachmentsToDelete
    }
  }

  /**
   * Deletes a file from the database. Does not delete metadata
   * @param {string} url - The url of the file to delete
   * @returns {Promise} - Promise resolving when deletion is complete
   */
  async delete(url, target) {
    return await UPDATE(target).where({ url }).with({ content: null })
  }
}


AttachmentsService.prototype._is_queueable = true

module.exports = AttachmentsService
