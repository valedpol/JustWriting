import { archiveDocument } from '../editor/archiveDocument.js'
import { parseDocument } from '../editor/document.js'
import { parseSemanticMarkup } from '../editor/semanticSnapshot.js'

const alphabet = new Intl.Collator('ru', { sensitivity: 'variant' })
const byDateAndPosition = (a, b) => b.dayKey.localeCompare(a.dayKey) || a.position - b.position || a.id.localeCompare(b.id)

// A readonly projection of assignments. Repeated titles and tag assignments
// retain their own item IDs/ranges; only the tag vocabulary is aggregated.
export function archiveSemanticIndex(records) {
  const titles = [], tags = new Map(), errors = []
  for (const record of records) {
    let markup
    try { markup = parseSemanticMarkup(record.semanticMarkup ?? [], parseDocument(archiveDocument(record)).content.size) }
    catch { errors.push(record.dayKey); continue }
    const recordTitles = markup.filter(item => item.kind === 'title').sort((a, b) => a.anchor - b.anchor)
    for (const item of markup) {
      const occurrence = { id: JSON.stringify([record.textId, item.id]), textId: record.textId, dayKey: record.dayKey,
        markupId: item.id, value: item.value, range: item.range, anchor: item.anchor, position: item.range?.from ?? item.anchor }
      if (item.kind === 'title') titles.push(occurrence)
      else {
        if (!tags.has(item.value)) tags.set(item.value, { value: item.value, count: 0, occurrences: [] })
        const tag = tags.get(item.value)
        const title = recordTitles.find(title => title.range && item.range && title.range.from <= item.range.from && title.range.to >= item.range.to)
          ?? recordTitles.find(title => title.range && title.range.from <= item.anchor && title.range.to >= item.anchor)
          ?? recordTitles.filter(title => title.anchor <= occurrence.position).at(-1) ?? recordTitles[0]
        tag.count++
        tag.occurrences.push({ ...occurrence, title: title?.value ?? null })
      }
    }
  }
  titles.sort((a, b) => alphabet.compare(a.value, b.value) || byDateAndPosition(a, b))
  const orderedTags = [...tags.values()].sort((a, b) => b.count - a.count || alphabet.compare(a.value, b.value))
  orderedTags.forEach(tag => tag.occurrences.sort(byDateAndPosition))
  return { titles, tags: orderedTags, errors }
}

export function archiveSemanticSelection(records, index, page, selected) {
  const item = page === 'title'
    ? index.titles.find(item => item.id === selected) ?? index.titles[0]
    : index.tags.find(item => item.value === selected) ?? index.tags[0]
  if (!item) return { selected: null, occurrences: [], records: [] }
  const occurrences = page === 'title' ? index.titles.filter(title => title.value === item.value) : item.occurrences
  const ids = new Set(occurrences.map(item => item.textId))
  return { selected: page === 'title' ? item.id : item.value, occurrences, records: records.filter(record => ids.has(record.textId)) }
}
