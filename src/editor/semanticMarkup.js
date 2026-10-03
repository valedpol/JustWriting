import { parseSemanticMarkup } from './semanticSnapshot.js'

// Insertions exactly outside either edge do not enlarge a selected fragment.
// Insertions inside it do. A replacement of the whole fragment removes its label.
export function mapSemanticMarkup(markup, mapping, doc = null) {
  return markup.flatMap(item => {
    // Continuing at an unresolved slash tag stays after its placement point.
    // Semantic direction is independent of insertion affinity for this point.
    const unresolvedTag = item.source === 'slash' && item.kind === 'tag' && item.range === null
    const result = mapping.mapResult(item.anchor, unresolvedTag ? -1 : item.direction === 'forward' ? -1 : 1)
    const anchor = result.pos
    if (item.range === null) {
      if (result.deletedAcross || (doc && paragraphRemoved(doc, item.anchor, mapping))) return []
      return [{ ...item, anchor, range: null }]
    }
    const start = mapping.mapResult(item.range.from, 1)
    const end = mapping.mapResult(item.range.to, -1)
    const from = start.pos
    const to = end.pos
    if (from >= to || (start.deleted && end.deleted)) return []
    return [{ ...item, anchor: item.source === 'selection' ? Math.max(from, Math.min(anchor, to)) : anchor, range: { from, to } }]
  })
}

// Called with the document and StepMap immediately before one text step.
// This detects destruction, without assigning an implicit semantic range.
function paragraphRemoved(doc, anchor, stepMap) {
  const position = doc.resolve(anchor)
  if (position.parent.type.name !== 'paragraph') return false
  const from = position.start()
  const to = position.end()
  let removed = false
  stepMap.forEach((oldStart, oldEnd) => {
    if (oldStart === oldEnd) return
    if (from < to ? oldStart <= from && oldEnd >= to
      : oldStart <= position.before() && oldEnd >= position.after()) removed = true
  })
  return removed
}

export function selectionMarkup(doc, selection, attributes) {
  if (selection.empty) throw new Error('Для смысловой разметки выделите текст')
  return parseSemanticMarkup([{
    ...attributes, source: 'selection',
    anchor: attributes.kind === 'title' ? selection.from : selection.to,
    direction: attributes.kind === 'title' ? 'forward' : 'backward',
    range: { from: selection.from, to: selection.to },
  }], doc.content.size)[0]
}

export function slashMarkup(doc, anchor, attributes) {
  return parseSemanticMarkup([{
    ...attributes, source: 'slash', anchor,
    direction: attributes.kind === 'title' ? 'forward' : 'backward', range: null,
  }], doc.content.size)[0]
}
