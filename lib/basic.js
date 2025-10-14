const cds = require('@sap/cds')
const { SELECT, UPSERT, UPDATE } = cds.ql
const { scanRequest } = require('./malwareScanner')
const { logConfig } = require('./logger')
const attachmentIDRegex = /\/\w+\(.*ID=([0-9a-fA-F-]{36})/

module.exports = class AttachmentsService extends cds.Service {
  /**
   * Uploads attachments to the database and initiates malware scans for database-stored files
   * @param {cds.Entity} attachments - Attachments entity definition
   * @param {Array|Object} data - The attachment data to be uploaded
   * @param {Buffer|Stream} _content - The content of the attachment (if not included in data)
   * @param {boolean} isDraftEnabled - Flag indicating if draft handling is enabled
   * @returns {Array} - Result of the upsert operation
   */
  async put(attachments, data, _content, isDraftEnabled = true) {
    if (!Array.isArray(data)) {
      if (_content) data.content = _content
      data = [data]
    }

    logConfig.info('Starting database attachment upload', {
      attachmentEntity: attachments.name,
      fileCount: data.length,
      filenames: data.map((d) => d.filename || 'unknown'),
      isDraftEnabled
    })

    let res
    if (isDraftEnabled) {
      logConfig.debug('Upserting attachment records to database', {
        attachmentEntity: attachments.name,
        recordCount: data.length
      })

      try {
        res = await Promise.all(
          data.map(async (d) => {
            return await UPSERT(d).into(attachments)
          })
        )

        logConfig.info('Attachment records upserted to database successfully', {
          attachmentEntity: attachments.name,
          recordCount: data.length
        })

      } catch (error) {
        logConfig.withSuggestion('error',
          'Failed to upsert attachment records to database', error,
          'Check database connectivity and attachment entity configuration',
          { attachmentEntity: attachments.name, recordCount: data.length, errorMessage: error.message })
        throw error
      }
    }

    // Initiate malware scanning for database-stored files
    if (this.kind === 'db') {
      logConfig.debug('Initiating malware scans for database-stored files', {
        fileCount: data.length,
        fileIds: data.map(d => d.ID)
      })

      const scanRequestJob = cds.spawn(async () => {
        await Promise.all(
          data.map(async (d) => {
            try {
              logConfig.debug('Starting scan request', { fileId: d.ID })
              await scanRequest(attachments, { ID: d.ID })

              logConfig.debug('Scan request completed', { fileId: d.ID })
            } catch (error) {
              logConfig.withSuggestion('error',
                'Failed to initiate malware scan for attachment', error,
                'Check malware scanner configuration and connectivity',
                { fileId: d.ID, filename: d.filename })
            }
          })
        )
      })

      scanRequestJob.on('error', (error) => {
        logConfig.withSuggestion('error',
          'Error occurred during malware scan requests', error,
          'Check malware scanner configuration and connectivity',
          { errorMessage: error.message })
      })
    }

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
    if (attachments.isDraft) {
      attachments = attachments.actives
    }
    logConfig.debug("Downloading attachment for", {
      attachmentName: attachments.name,
      attachmentKeys: keys
    })
    const result = await SELECT.from(attachments, keys).columns("content")
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
   * Handles non-draft attachment updates by uploading content to the database
   * @param {Express.Request} req - The request object
   * @param {cds.Entity} attachment - Attachments entity definition
   * @returns 
   */
  async nonDraftHandler(req, attachment) {
    if (req?.content?.url?.endsWith("/content")) {
      const attachmentID = req.content.url.match(attachmentIDRegex)[1]
      const data = { ID: attachmentID, content: req.content }
      const isDraftEnabled = false
      return this.put(attachment, [data], null, isDraftEnabled)
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
   * @param {cds.Entity} entity - The entity containing attachment associations
   * @param {cds.Entity} target - Attachments entity definition to register handlers for
   */
  registerUpdateHandlers(srv, entity, target) {
    srv.after("PUT", target, async (req) => {
      await this.nonDraftHandler(req, target)
    })
  }

  /**
   * Registers draft save handler for attachment entities in the service
   * @param {cds.Service} srv - The CDS service instance
   * @param {cds.Entity} entity - The entity containing attachment associations
   * @param {cds.Entity} target - Attachments entity definition to register handlers for
   */
  registerDraftUpdateHandlers(srv, entity, target) {
    srv.after("SAVE", entity, this.draftSaveHandler(target))
    return
  }

  /**
   * Updates attachment metadata in the database
   * @param {cds.Entity} Attachments - Attachments entity definition
   * @param {string} key - The key of the attachment to update
   * @param {*} data - The data to update the attachment with
   * @returns 
   */
  async update(Attachments, key, data) {
    logConfig.debug("Updating attachment for", {
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
   * Deletes the content of an infected attachment by setting its content to null
   * @param {cds.Entity} Attachments - Attachments entity definition
   * @param {string} key - The key of the attachment to delete
   * @returns {Promise} - Result of the update operation
   */
  async deleteInfectedAttachment(Attachments, key) {
    return await UPDATE(Attachments, key).with({ content: null })
  }
}
