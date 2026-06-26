const cds = require("@sap/cds")

/**
 * Recursively walks an entity's composition tree to collect all paths leading to
 * attachment entities (marked with @_is_media_data). Cycle-safe via visitedEdges.
 * @param {import('@sap/cds').entity} ent - The entity to start walking from
 * @param {string[][]} resultSet - Accumulator for found paths; each path is an array of composition element names
 * @param {string[]} path - The current path from the root entity to the node being visited
 * @param {Set<string>} visitedEdges - Tracks visited "entity.element" edges to prevent infinite loops
 * @returns {string[][]} All composition paths that lead to an attachment entity
 */
function collectAttachments(
  ent,
  resultSet = [],
  path = [],
  visitedEdges = new Set(),
) {
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

/**
 * Returns the field prefixes for any inline attachments on an entity (e.g. "myAttachment"
 * for a field named "myAttachment_content" marked with @_is_media_data).
 * Returns an empty array for composition-based attachment entities.
 * @param {import('@sap/cds').entity} entity - The entity definition to inspect
 * @returns {string[]} List of inline attachment field prefixes
 */
function getInlineAttachmentPrefixes(entity) {
  if (entity?.["@_is_media_data"]) return [] // entity itself is composition-based
  const prefixes = []
  for (const [name, elem] of Object.entries(entity?.elements ?? {})) {
    if (name.endsWith("_content") && elem?.["@_is_media_data"]) {
      prefixes.push(name.slice(0, -"_content".length))
    }
  }
  return prefixes
}

/**
 * Checks whether an entity has a composition path (direct or nested) that leads to an
 * attachment entity. Cycle-safe via visitedEdges.
 * @param {import('@sap/cds').entity} entity - The entity definition to inspect
 * @param {Set<string>} visitedEdges - Tracks visited "entity.element" edges to prevent infinite loops
 * @returns {boolean} True if any composition in the tree targets an attachment entity
 */
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
      get inlineAttachmentPrefixes() {
        delete this.inlineAttachmentPrefixes
        this.inlineAttachmentPrefixes = getInlineAttachmentPrefixes(entity)
        return this.inlineAttachmentPrefixes
      },
      get hasInlineAttachments() {
        delete this.hasInlineAttachments
        this.hasInlineAttachments =
          getInlineAttachmentPrefixes(entity).length > 0
        return this.hasInlineAttachments
      },
    }
  },
})
