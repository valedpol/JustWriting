export default function SearchHighlights({ value, occurrences = [], activeId }) {
  const parts = []
  let cursor = 0
  for (const occurrence of occurrences) {
    parts.push(value.slice(cursor, occurrence.from))
    parts.push(<mark key={occurrence.id} data-search-occurrence={occurrence.id}
      className={`archive-search-match${occurrence.id === activeId ? ' is-current' : ''}`}>
      {value.slice(occurrence.from, occurrence.to)}
    </mark>)
    cursor = occurrence.to
  }
  parts.push(value.slice(cursor))
  return parts
}
