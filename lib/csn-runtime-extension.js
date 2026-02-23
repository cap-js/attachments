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

function hasAttachmentsComposition(entity, visited = new Set()) {
  if (!entity.compositions || visited.has(entity.name)) return false
  visited.add(entity.name)
  return Object.keys(entity.compositions).some(
    (ele) =>
      entity.compositions[ele]._target?.["@_is_media_data"] ||
      hasAttachmentsComposition(entity.compositions[ele]._target, visited),
  )
}

Object.defineProperty(cds.builtin.classes.entity.prototype, "_attachments", {
  get() {
    const entity = this
    return {
      get hasAttachmentsComposition() {
        return hasAttachmentsComposition(entity)
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
