import test from 'node:test'
import assert from 'node:assert/strict'
import { archiveSemanticIndex, archiveSemanticSelection } from './archiveSemanticIndex.js'

const item = (id, kind, value, from = 1, to = 5) => ({ id, valueId: `value-${value}`, kind, value, source: 'selection',
  direction: kind === 'title' ? 'forward' : 'backward', anchor: kind === 'title' ? from : to, range: { from, to } })
const record = (textId, dayKey, semanticMarkup) => ({ textId, dayKey, content: 'Первый фрагмент\r\nВторой фрагмент', semanticMarkup })

test('titles are alphabetic in Russian, duplicate titles retain distinct dated ranges; projection does not mutate legacy CRLF records', () => {
  const records = [record('one', '2026-10-01', [item('a', 'title', 'Ясень'), item('b', 'title', 'Ворона', 8, 12)]),
    record('two', '2026-10-02', [item('c', 'title', 'Азбука'), item('d', 'title', 'Ворона', 14, 18)])]
  const before = structuredClone(records), index = archiveSemanticIndex(records)
  assert.deepEqual(index.titles.map(row => [row.value, row.dayKey, row.markupId]), [
    ['Азбука', '2026-10-02', 'c'], ['Ворона', '2026-10-02', 'd'], ['Ворона', '2026-10-01', 'b'], ['Ясень', '2026-10-01', 'a'],
  ])
  assert.deepEqual(index.titles.find(row => row.markupId === 'd').range, { from: 14, to: 18 })
  assert.equal(new Set(index.titles.map(row => row.id)).size, 4)
  assert.deepEqual(records, before)
})

test('tags aggregate by existing exact value, count assignments rather than days and order by frequency with alphabetic ties', () => {
  const records = [record('one', '2026-10-01', [item('title', 'title', 'Название', 1, 12), item('a', 'tag', 'JW'), item('b', 'tag', 'JW', 8, 12), item('c', 'tag', 'Редкий')]),
    record('two', '2026-10-02', [item('d', 'tag', 'JW'), item('e', 'tag', 'Азбука')])]
  const index = archiveSemanticIndex(records)
  assert.deepEqual(index.tags.map(tag => [tag.value, tag.count]), [['JW', 3], ['Азбука', 1], ['Редкий', 1]])
  assert.deepEqual(index.tags[0].occurrences.map(row => [row.textId, row.markupId]), [['two', 'd'], ['one', 'a'], ['one', 'b']])
  assert.equal(index.tags[0].occurrences[1].title, 'Название')
  assert.equal(index.tags[0].occurrences[0].title, null)
})

test('unresolved slash items remain navigable at their stored anchor; invalid markup reports its day without inventing a range', () => {
  const unresolved = { ...item('open', 'title', 'Начало'), source: 'slash', range: null, anchor: 9 }
  const invalid = { ...item('bad', 'tag', 'Сломанный'), range: { from: 1, to: 999 } }
  const index = archiveSemanticIndex([record('one', '2026-10-01', [unresolved]), record('two', '2026-10-02', [invalid])])
  assert.equal(index.titles[0].position, 9)
  assert.equal(index.titles[0].range, null)
  assert.deepEqual(index.errors, ['2026-10-02'])
  assert.deepEqual(index.tags, [])
})


test('selector defaults to first item, duplicate titles match all corresponding days, tag cards deduplicate assignments in archive order', () => {
  const records = [record('one', '2026-10-01', [item('a', 'title', 'Ворона'), item('b', 'title', 'Ворона', 8, 12), item('c', 'tag', 'JW'), item('d', 'tag', 'JW', 8, 12)]),
    record('two', '2026-10-02', [item('e', 'title', 'Азбука'), item('f', 'tag', 'Редкий')]),
    record('three', '2026-10-03', [item('g', 'title', 'Ворона'), item('h', 'tag', 'JW')])]
  const before = structuredClone(records), index = archiveSemanticIndex(records)
  assert.deepEqual(archiveSemanticSelection(records, index, 'title', null).records.map(row => row.textId), ['two'])
  for (const title of index.titles.filter(row => row.value === 'Ворона')) {
    const selected = archiveSemanticSelection(records, index, 'title', title.id)
    assert.equal(selected.selected, title.id)
    assert.equal(selected.occurrences.length, 3)
    assert.deepEqual(selected.records.map(row => row.textId), ['one', 'three'])
  }
  const tags = archiveSemanticSelection(records, index, 'tag', null)
  assert.equal(tags.selected, 'JW')
  assert.equal(tags.occurrences.length, 3)
  assert.deepEqual(tags.records.map(row => row.textId), ['one', 'three'])
  assert.deepEqual(archiveSemanticSelection(records, index, 'tag', 'Редкий').records.map(row => row.textId), ['two'])
  assert.equal(archiveSemanticSelection(records, index, 'tag', 'removed').selected, 'JW')
  assert.deepEqual(archiveSemanticSelection([], archiveSemanticIndex([]), 'title', null), { selected: null, occurrences: [], records: [] })
  assert.deepEqual(records, before)
})
