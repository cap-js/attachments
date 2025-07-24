const cds = require('@sap/cds');
const DEBUG = cds.debug('attachments');
const { SELECT, UPSERT, UPDATE } = cds.ql;
const { scanRequest } = require('./malwareScanner')

module.exports = class AttachmentsService extends cds.Service {

  async put(attachments, data, _content, isDraftEnabled = true) {
    if (!Array.isArray(data)) {
      if (_content) data.content = _content;
      data = [data];
    }

    DEBUG?.("Uploading attachments for", attachments.name, data.map?.(d => d.filename));

    try {
      let res;
      if (isDraftEnabled) {
        res = await Promise.all(data.map(async (d) => {
          try {
            return await UPSERT(d).into(attachments);
          } catch (err) {
            cds.log('attachments').error('[PUT][UpsertError]', err);
            throw err;
          }
        }));
      }

      if (this.kind === 'db') {
        for (const d of data) {
          try {
            scanRequest(attachments, { ID: d.ID });
          } catch (err) {
            cds.log('attachments').error('[PUT][ScanRequestError]', err);
          }
        }
      }

      return res;
    } catch (err) {
      cds.log('attachments').error('[PUT][UploadError]', err);
      throw err;
    }
  }

  // eslint-disable-next-line no-unused-vars
  async get(attachments, keys, req = {}) {
    if (attachments.isDraft) attachments = attachments.actives;
    DEBUG?.("Downloading attachment for", attachments.name, keys);
    try {
      const result = await SELECT.from(attachments, keys).columns("content");
      return result?.content || null;
    } catch (err) {
      cds.log('attachments').error('[GET][DownloadError]', err);
      throw err;
    }
  }

  /**
   * Returns a handler to copy updated attachments content from draft to active / object store
   */
  draftSaveHandler(attachments) {
    const queryFields = this.getFields(attachments);

    return async (_, req) => {
      try {
        // Build WHERE clause based on primary key mappings (e.g., up_)
        const baseWhere = req.subject.ref[0].where.map((x) =>
          x.ref ? { ref: ["up_", ...x.ref] } : x
        );

        // Construct SELECT CQN to fetch draft attachments with non-null content
        const cqn = SELECT(queryFields)
          .from(attachments.drafts)
          .where(baseWhere);

        // Add filter to exclude drafts with empty or null content
        cqn.where({ content: { '!=': null } });

        const draftAttachments = await cqn;

        // Upload fetched attachments (if any)
        if (draftAttachments.length) {
          await this.put(attachments, draftAttachments);
        }
      } catch (err) {
        const logger = cds.log('attachments');
        logger.error('[DRAFT_SAVE_HANDLER]', err);
        req?.error?.(500, 'Failed to process draft attachments.');
      }
    };
  }

  async nonDraftHandler(attachments, data) {
    const isDraftEnabled = false;
    try {
      return await this.put(attachments, [data], null, isDraftEnabled);
    } catch (err) {
      cds.log('attachments').error('[NON_DRAFT][UploadError]', err);
      throw err;
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

  async registerUpdateHandlers(srv, entity, target) {
    try {
      srv.after("SAVE", entity, this.draftSaveHandler(target));
    } catch (err) {
      cds.log('attachments').error('[REGISTER_UPDATE_HANDLERS][Error]', err);
    }
  }

  async update(Attachments, key, data) {
    DEBUG?.("Updating attachment for", Attachments.name, key);
    try {
      return await UPDATE(Attachments, key).with(data);
    } catch (err) {
      cds.log('attachments').error('[UPDATE][Error]', err);
      throw err;
    }
  }

  async getStatus(Attachments, key) {
    try {
      const result = await SELECT.from(Attachments, key).columns('status');
      return result?.status;
    } catch (err) {
      cds.log('attachments').error('[GET_STATUS][Error]', err);
      throw err;
    }
  }

  async deleteInfectedAttachment(Attachments, key) {
    try {
      return await UPDATE(Attachments, key).with({ content: null });
    } catch (err) {
      cds.log('attachments').error('[DELETE_INFECTED][Error]', err);
      throw err;
    }
  }
};
