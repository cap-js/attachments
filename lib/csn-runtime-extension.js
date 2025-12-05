const cds = require('@sap/cds')

Object.defineProperty(cds.builtin.classes.entity.prototype, '_attachments', {
  get() {
    const entity = this;
    return {
      get hasAttachmentsComposition() {
        if (!entity.compositions) return false
        return entity.compositions && Object.keys(entity.compositions).some(ele => entity.compositions[ele]._target?.["@_is_media_data"] || entity.compositions[ele]._target?._attachments?.hasAttachmentsComposition)
      },
      get attachmentCompositions() {
        const resultSet = []
        function collectAttachments(ent, path = []) {
          if (!ent.compositions) return
          for (const ele of Object.keys(ent.compositions)) {
            const target = ent.compositions[ele]._target
            const newPath = [...path, ele]
            if (target?.["@_is_media_data"]) {
              resultSet.push(newPath)
            }
            if (target && target !== ent) collectAttachments(target, newPath)
          }
        }
        collectAttachments(entity)
        return resultSet
      },
      get isAttachmentsEntity() {
        return !!entity?.["@_is_media_data"]
      }
    }
  },
})
