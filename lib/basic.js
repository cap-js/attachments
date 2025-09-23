const cds = require('@sap/cds');
const { SELECT, UPSERT, UPDATE } = cds.ql;
const { scanRequest } = require('./malwareScanner')
const { logConfig } = require('./logger');
const attachmentIDRegex = /\/\w+\(.*ID=([0-9a-fA-F-]{36})/

module.exports = class AttachmentsService extends cds.Service {

  async put(attachments, data, _content, isDraftEnabled = true) {
    if (!Array.isArray(data)) {
      if (_content) data.content = _content;
      data = [data];
    }

    logConfig.info('Starting database attachment upload', {
      attachmentEntity: attachments.name,
      fileCount: data.length,
      filenames: data.map((d) => d.filename || 'unknown'),
      isDraftEnabled
    });

    let res;
    if (isDraftEnabled) {
      logConfig.debug('Upserting attachment records to database', {
        attachmentEntity: attachments.name,
        recordCount: data.length
      });

      try {
        res = await Promise.all(
          data.map(async (d) => {
            return await UPSERT(d).into(attachments);
          })
        );

        logConfig.fileOperation('database_store', 'multiple', 'multiple', true, {
          attachmentEntity: attachments.name,
          recordCount: data.length
        });

      } catch (error) {
        logConfig.fileOperation('database_store', 'multiple', 'multiple', false, {
          attachmentEntity: attachments.name,
          recordCount: data.length,
          errorMessage: error.message,
          suggestion: 'Check database connectivity and attachment entity configuration'
        });
        throw error;
      }
    }

    // Initiate malware scanning for database-stored files
    if (this.kind === 'db') {
      logConfig.debug('Initiating malware scans for database-stored files', {
        fileCount: data.length,
        fileIds: data.map(d => d.ID)
      });

      await Promise.all(
        data.map(async (d) => {
          try {
            logConfig.malwareScan(d.ID, 'Initiating');
            await scanRequest(attachments, { ID: d.ID });
            logConfig.malwareScan(d.ID, 'Scan request completed');
          } catch (error) {
            logConfig.error('Failed to initiate malware scan', error, {
              fileId: d.ID,
              filename: d.filename
            });
          }
        })
      );
    }

    return res;
  }

  // eslint-disable-next-line no-unused-vars
  async get(attachments, keys, req = {}) {
    if (attachments.isDraft) {
      attachments = attachments.actives;
    }
    logConfig.debug("Downloading attachment for", {
      attachmentName: attachments.name,
      attachmentKeys: keys
    });
    const result = await SELECT.from(attachments, keys).columns("content");
    return (result?.content) ? result.content : null;
  }

  /**
   * Returns a handler to copy updated attachments content from draft to active / object store
   */
  draftSaveHandler(attachments) {
    const queryFields = this.getFields(attachments);


    return async (_, req) => {
      // The below query loads the attachments into streams
      const cqn = SELECT(queryFields)
        .from(attachments.drafts)
        .where([
          ...req.subject.ref[0].where.map((x) =>
            x.ref ? { ref: ["up_", ...x.ref] } : x
          )
          // NOTE: needs skip LargeBinary fix to Lean Draft
        ]);
      cqn.where({ content: { '!=': null } })
      const draftAttachments = await cqn

      if (draftAttachments.length)
        await this.put(attachments, draftAttachments);
    };
  }

  async nonDraftHandler(req, attachment) {
    if (req?.content?.url?.endsWith("/content")) {
      const attachmentID = req.content.url.match(attachmentIDRegex)[1];
      const data = { ID: attachmentID, content: req.content }
      const isDraftEnabled = false;
      return this.put(attachment, [data], null, isDraftEnabled);
    }
  }

  getFields(attachments) {
    const attachmentFields = ["filename", "mimeType", "content", "url", "ID"];
    const { up_ } = attachments.keys;
    if (up_)
      return up_.keys
        .map((k) => "up__" + k.ref[0])
        .concat(...attachmentFields)
        .map((k) => ({ ref: [k] }));
    else return Object.keys(attachments.keys);
  }

  registerUpdateHandlers(srv, entity, target) {
    srv.after("PUT", target, async (req) => {
      await this.nonDraftHandler(req, target);
    });
  }

  registerDraftUpdateHandlers(srv, entity, target) {
    srv.after("SAVE", entity, this.draftSaveHandler(target));
    return;
  }

  async update(Attachments, key, data) {
    logConfig.debug("Updating attachment for", {
      attachmentName: Attachments.name,
      attachmentKey: key
    })
    return await UPDATE(Attachments, key).with(data)
  }

  async getStatus(Attachments, key) {
    const result = await SELECT.from(Attachments, key).columns('status')
    return result?.status;
  }

  async deleteInfectedAttachment(Attachments, key) {
    return await UPDATE(Attachments, key).with({ content: null })
  }
};
