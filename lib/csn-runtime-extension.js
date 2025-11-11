const cds = require('@sap/cds')
const { LinkedDefinitions } = require("@sap/cds/lib/core/linked-csn")

Object.defineProperty(cds.builtin.classes.entity.prototype, '_attachments', {
  get() {
    const entity = this;
    return {
      get hasAttachmentsComposition() {
        return entity.compositions && Object.keys(entity.compositions).some(ele => entity.compositions[ele]._target?.["@_is_media_data"] || entity.compositions[ele]._target?._attachments.hasAttachmentsComposition)
      },
      get attachmentCompositions() {
        const resultSet = new LinkedDefinitions()
        if (!entity.compositions) return resultSet
        for (const ele of Object.keys(entity.compositions).filter(ele => entity.compositions[ele]._target?.["@_is_media_data"] || entity.compositions[ele]._target?._attachments.hasAttachmentsComposition)) {
          resultSet[ele] = entity.compositions[ele]
        };
        return resultSet;
      },
      get isAttachmentsEntity() {
        return !!entity?.["@_is_media_data"]
      }
    }
  },
})
