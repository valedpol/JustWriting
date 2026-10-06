import { Decoration, DecorationSet } from '@tiptap/pm/view'

export function searchDecorations(doc, occurrences = [], activeId) {
  return DecorationSet.create(doc, occurrences.filter(item => item.entity === 'text').flatMap(item =>
    item.ranges.map(range => Decoration.inline(range.from, range.to, {
      class: `archive-search-match${item.id === activeId ? ' is-current' : ''}`,
      'data-search-occurrence': item.id,
    }))))
}
