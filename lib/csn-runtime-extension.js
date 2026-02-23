const cds = require("@sap/cds")

function collectAttachments(
  ent,
  resultSet = [],
  path = [],
  visited = new Set(),
) {
  if (!ent.compositions || visited.has(ent.name)) return resultSet
  visited.add(ent.name)
  for (const [ele, comp] of Object.entries(ent.compositions)) {
    const target = comp._target
    const newPath = [...path, ele]
    if (target?.["@_is_media_data"]) {
      resultSet.push(newPath)
    }
    if (target) collectAttachments(target, resultSet, newPath, visited)
  }
  return resultSet
}

Object.defineProperty(cds.builtin.classes.entity.prototype, "_attachments", {
  get() {
    const entity = this
    return {
      get hasAttachmentsComposition() {
        const _hasAttachmentsComposition = (currentEntity, visited) => {
          if (!currentEntity?.compositions || visited.has(currentEntity.name)) {
            return false
          }
          visited.add(currentEntity.name)

          return Object.keys(currentEntity.compositions).some(
            (ele) =>
              currentEntity.compositions[ele]._target?.["@_is_media_data"] ||
              _hasAttachmentsComposition(
                currentEntity.compositions[ele]._target,
                visited,
              ),
          )
        }
        return _hasAttachmentsComposition(entity, new Set())
      },
      get attachmentCompositions() {
        return collectAttachments(entity)
      },
      get isAttachmentsEntity() {
        return !!entity?.["@_is_media_data"]
      },
    }
  },
})
