import { archiveDocument } from '../editor/archiveDocument.js'
import { parseDocument } from '../editor/document.js'
import { parseSemanticMarkup } from '../editor/semanticSnapshot.js'

function normalized(value) {
  let text = '', offsets = []
  for (let offset = 0; offset < value.length;) {
    const character = String.fromCodePoint(value.codePointAt(offset))
    const folded = character.toLowerCase().replaceAll('ё', 'е')
    for (let i = 0; i < folded.length; i++) offsets.push({ from: offset, to: offset + character.length })
    text += folded
    offset += character.length
  }
  return { text, offsets }
}

export function searchRanges(value, query) {
  if (!query) return []
  const needle = normalized(query).text
  const haystack = normalized(value)
  const ranges = []
  for (let at = haystack.text.indexOf(needle); at !== -1; at = haystack.text.indexOf(needle, at + needle.length)) {
    ranges.push({ from: haystack.offsets[at].from, to: haystack.offsets[at + needle.length - 1].to })
  }
  return ranges
}

// Map exact saved-content offsets to the existing PM document, including
// legacy CRLF and text nodes split by formatting. No document is rewritten.
function contentPositions(record, doc) {
  let projected = '', positions = []
  doc.forEach((block, offset, index) => {
    if (index) { projected += '\n'; positions.push(null) }
    block.descendants((node, pos) => {
      if (node.isText) {
        projected += node.text
        for (let i = 0; i < node.text.length; i++) positions.push(offset + 1 + pos + i)
      } else if (node.type.name === 'hardBreak') { projected += '\n'; positions.push(offset + 1 + pos) }
    })
  })
  if (record.content.replace(/\r\n?/g, '\n') !== projected) throw new Error('Содержимое и документ не согласованы для поиска')
  const raw = []
  let cursor = 0
  for (let i = 0; i < record.content.length; i++) {
    raw.push(positions[cursor])
    if (record.content[i] === '\r' && record.content[i + 1] === '\n') { raw.push(positions[cursor]); i++ }
    cursor++
  }
  return raw
}

export function archiveSearch(records, query) {
  const occurrences = [], matched = []
  const counts = { text: 0, title: 0, tag: 0 }
  if (!query) return { records, occurrences, counts }
  for (const record of records) {
    const doc = parseDocument(archiveDocument(record))
    const positions = contentPositions(record, doc)
    const found = searchRanges(record.content, query).map(range => {
      const mapped = positions.slice(range.from, range.to).filter(pos => pos !== null)
      const ranges = []
      for (const pos of [...new Set(mapped)]) {
        const last = ranges.at(-1)
        if (last && last.to === pos) last.to++
        else ranges.push({ from: pos, to: pos + 1 })
      }
      return { ...range, entity: 'text', position: ranges[0]?.from ?? 0, ranges, order: -1 }
    })
    // Stable sort matches SemanticRail's saved ordering at equal anchors.
    const markup = parseSemanticMarkup(record.semanticMarkup ?? [], doc.content.size)
      .map((item, order) => ({ ...item, order })).sort((a, b) => a.anchor - b.anchor)
    for (const item of markup) for (const range of searchRanges(item.value, query)) {
      found.push({ ...range, entity: item.kind, markupId: item.id, position: item.anchor, order: item.order })
    }
    found.sort((a, b) => a.position - b.position || a.order - b.order || a.from - b.from)
    if (found.length) matched.push(record)
    for (const item of found) {
      const occurrence = { ...item, textId: record.textId,
        id: JSON.stringify([record.textId, item.entity, item.markupId ?? null, item.from, item.to]) }
      occurrences.push(occurrence)
      counts[item.entity]++
    }
  }
  return { records: matched, occurrences, counts }
}
