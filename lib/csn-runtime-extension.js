const cds = require("@sap/cds")

function collectAttachments(ent, resultSet = [], path = [], visitedEdges = new Set()) {
  if (!ent?.compositions) return resultSet

  for (const [ele, comp] of Object.entries(ent.compositions)) {
    const edgeKey = `${ent.name}.${ele}`
    if (visitedEdges.has(edgeKey)) continue 

    const target = comp._target
    const newPath = [...path, ele]

    if (target?.["@_is_media_data"]) {
      resultSet.push(newPath)
    } else if (target) {
      const newVisitedEdges = new Set(visitedEdges)
      newVisitedEdges.add(edgeKey)
      collectAttachments(target, resultSet, newPath, newVisitedEdges)
    }
  }
  return resultSet
}

function hasAttachmentsComposition(entity, visitedEdges = new Set()) {
  if (!entity?.compositions) return false

  return Object.keys(entity.compositions).some((ele) => {
    const edgeKey = `${entity.name}.${ele}`
    if (visitedEdges.has(edgeKey)) return false

    const target = entity.compositions[ele]._target
    if (target?.["@_is_media_data"]) return true

    const newVisitedEdges = new Set(visitedEdges)
    newVisitedEdges.add(edgeKey)
    return hasAttachmentsComposition(target, newVisitedEdges)
  })
}

Object.defineProperty(cds.builtin.classes.entity.prototype, "_attachments", {
  get() {
    const entity = this
    return {
      get hasAttachmentsComposition() {
        delete this.hasAttachmentsComposition
        this.hasAttachmentsComposition = hasAttachmentsComposition(entity)
        return this.hasAttachmentsComposition
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
