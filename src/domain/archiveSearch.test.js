import test from 'node:test'
import assert from 'node:assert/strict'
import { archiveSearch, searchRanges } from './archiveSearch.js'
import { filterArchivePeriod } from './archivePeriod.js'
import { archiveDocument } from '../editor/archiveDocument.js'
import { parseDocument } from '../editor/document.js'
import { searchDecorations } from '../editor/searchDecorations.js'

const semantic = (id, kind, value, anchor = 1) => ({ id, valueId: id, kind, value, anchor, source: 'selection',
  direction: kind === 'title' ? 'forward' : 'backward', range: { from: 1, to: 3 } })
const records = [
  { textId: 'a', dayKey: '2026-09-26', content: 'Ёж ёж ЕЖ', semanticMarkup: [semantic('t', 'title', 'Еж'), semantic('g', 'tag', 'ёж')] },
  { textId: 'b', dayKey: '2026-10-03', content: 'Другой день', semanticMarkup: [semantic('b', 'tag', 'Ёж')] },
  { textId: 'c', dayKey: '2026-10-04', content: 'Без совпадения' },
]
test('substring matching is case/е-ё insensitive, whole phrase, preserves exact source offsets', () => {
  assert.deepEqual(searchRanges('Ёж ЕЖ ёж', 'еж'), [{ from: 0, to: 2 }, { from: 3, to: 5 }, { from: 6, to: 8 }])
  assert.equal(searchRanges('первый второй первый иной второй', 'ПЕРВЫЙ ВТОРОЙ').length, 1)
  assert.deepEqual(searchRanges('😀 İ Ёж', 'еж'), [{ from: 5, to: 7 }])
  assert.deepEqual(searchRanges('x', ''), [])
})
test('occurrences count all entities, preserve archive order, rail order at ties, and unique matching records', () => {
  const before = structuredClone(records)
  const result = archiveSearch(records, 'еж')
  assert.equal(result.occurrences.length, 6)
  assert.equal(result.records.length, 2)
  assert.deepEqual(result.counts, { text: 3, title: 1, tag: 2 })
  assert.deepEqual(result.occurrences.slice(0, 3).map(item => item.entity), ['text', 'title', 'tag'])
  assert.equal(new Set(result.occurrences.map(item => item.id)).size, 6)
  assert.deepEqual(archiveSearch(filterArchivePeriod(records, '2026-10'), 'еж').records.map(item => item.textId), ['b'])
  assert.equal(archiveSearch(records, 'нет').records.length, 0)
  assert.equal(archiveSearch(records, '').records, records)
  assert.deepEqual(records, before)
})
test('legacy CRLF and rich formatting map to decorations without changing document, marks, content or metadata', () => {
  for (const content of ['😀 Ёж\r\nЕЖ\rёж', '😀 Ёж\nЕЖ']) {
    const record = { textId: 'legacy', content, revision: 1 }
    const document = archiveDocument(record)
    // Same immutable saved content can coexist with an upgraded rich document.
    for (const rich of [false, true]) {
      const input = rich ? { ...record, document, contentFormat: 'tiptap-json', contentVersion: 1 } : record
      const before = structuredClone(input)
      const doc = parseDocument(archiveDocument(input))
      const results = archiveSearch([input], 'еж')
      const decorations = searchDecorations(doc, results.occurrences, results.occurrences[0].id).find()
      assert.equal(decorations.length, results.occurrences.length)
      for (const decoration of decorations) assert.match(doc.textBetween(decoration.from, decoration.to).toLowerCase(), /[её]ж/)
      assert.ok(decorations[0].type.attrs.class.includes('is-current'))
      assert.deepEqual(input, before)
      assert.deepEqual(doc.toJSON(), document)
    }
  }
})

test('multiword matches cross formatting nodes and paragraph boundaries using the existing document positions', () => {
  const record = { textId: 'rich', content: 'Один два\nЁж', contentFormat: 'tiptap-json', contentVersion: 1,
    document: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Один ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'два' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Ёж', marks: [{ type: 'italic' }, { type: 'underline' }] }] },
    ] } }
  const before = structuredClone(record)
  const result = archiveSearch([record], 'один два\nеж')
  assert.equal(result.occurrences.length, 1)
  assert.deepEqual(result.occurrences[0].ranges, [{ from: 1, to: 9 }, { from: 11, to: 13 }])
  const doc = parseDocument(record.document)
  searchDecorations(doc, result.occurrences, result.occurrences[0].id)
  assert.deepEqual(record, before)
  assert.ok(doc.rangeHasMark(1, 5, doc.type.schema.marks.bold))
})

test('title-only matches are full results; unknown record fields and exact values remain untouched', () => {
  const row = { textId: 'only-title', content: 'Иное содержимое', dayKey: '2026-10-01', extra: { future: null },
    semanticMarkup: [semantic('title-only', 'title', 'ЁЖ еж')] }
  const before = structuredClone(row)
  const result = archiveSearch([row], 'еж')
  assert.deepEqual(result.records, [row])
  assert.deepEqual(result.counts, { text: 0, title: 2, tag: 0 })
  assert.deepEqual(row, before)
})
