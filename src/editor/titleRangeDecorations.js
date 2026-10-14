import { Decoration } from '@tiptap/pm/view'

// A view of the original readonly document: positions, marks and metadata stay
// in source coordinates. No sliced document is saved or used as an editor state.
export function titleRangeDecorations(doc, visibleRange, contextRange) {
  const decorations = []
  if (visibleRange) {
    const { from, to } = visibleRange
    doc.descendants((node, pos) => {
      if (node.isBlock && (pos + node.nodeSize <= from || pos >= to ||
        (node.isTextblock && (pos + node.nodeSize - 1 <= from || pos + 1 >= to)))) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'archive-title-hidden' }))
        return false
      }
      if (node.isText) {
        if (pos < from) decorations.push(Decoration.inline(pos, Math.min(pos + node.nodeSize, from), { class: 'archive-title-hidden' }))
        if (pos + node.nodeSize > to) decorations.push(Decoration.inline(Math.max(pos, to), pos + node.nodeSize, { class: 'archive-title-hidden' }))
      } else if (node.isInline && (pos < from || pos >= to)) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'archive-title-hidden' }))
      }
    })
  }
  if (contextRange) decorations.push(Decoration.inline(contextRange.from, contextRange.to, { class: 'archive-title-context' }))
  return decorations
}
