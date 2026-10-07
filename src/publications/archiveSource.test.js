import test from 'node:test'
import assert from 'node:assert/strict'
import { AllSelection, TextSelection } from '@tiptap/pm/state'
import { archiveDocument } from '../editor/archiveDocument.js'
import { parseDocument, legacyToDocument, documentToContent } from '../editor/document.js'
import { canonicalArchiveRange, prepareArchiveSnapshot } from './archiveSource.js'
import { publicationDuplicateKey } from './model.js'

const day = { userId: 'u', userDayId: 'd', dayKey: '2026-10-07' }
const text = { userId: 'u', textId: 't', userDayId: 'd', dayKey: day.dayKey, revision: 2, content: '  abc\r\ndef  ' }
const source = range => ({ sourceType: 'archive', sourceId: 't', sourceRevision: 2, coordinateVersion: 1, range, archive: { userDayId: 'd', dayKey: day.dayKey } })
const title = (id, value, range) => ({ id, valueId: id, kind: 'title', value, source: range ? 'selection' : 'slash', anchor: range?.from ?? 1, direction: 'forward', range })

test('mouse and right-date full selections canonicalize identically, preserving whitespace and CRLF', async () => {
  const doc = parseDocument(archiveDocument(text))
  const all = new AllSelection(doc), mouse = TextSelection.create(doc, 1, doc.content.size - 1)
  assert.deepEqual(canonicalArchiveRange(doc, all), canonicalArchiveRange(doc, mouse))
  const a = await prepareArchiveSnapshot('u', source(all), text, day)
  const b = await prepareArchiveSnapshot('u', source(mouse), text, day)
  assert.deepEqual(a, b)
  assert.equal(a.snapshot.content, text.content)
  assert.equal(documentToContent(a.snapshot.document), '  abc\ndef  ')
})

for (const content of ['a\rb\r', 'a\r\nb\r\n', '😀 a\n\nb\t ', 'a\n\n']) {
  test(`exact legacy content: ${JSON.stringify(content)}`, async () => {
    const record = { ...text, content }
    const doc = parseDocument(archiveDocument(record))
    const prepared = await prepareArchiveSnapshot('u', source({ from: 0, to: doc.content.size }), record, day)
    assert.equal(prepared.snapshot.content, content)
  })
}

test('partial and multi-paragraph rich snapshots retain B/I/U and no semantic payload', async () => {
  const document = legacyToDocument('abc\ndef')
  document.content[0].content[0].marks = [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }]
  const record = { ...text, content: 'abc\ndef', document, contentFormat: 'tiptap-json', contentVersion: 1 }
  const doc = parseDocument(document)
  const result = await prepareArchiveSnapshot('u', source({ from: 2, to: doc.content.size - 2 }), record, day)
  assert.equal(result.snapshot.content, 'bc\nde')
  assert.deepEqual(result.snapshot.document.content[0].content[0].marks.map(m => m.type).sort(), ['bold', 'italic', 'underline'])
  assert.equal('semanticMarkup' in result.snapshot, false)
})

test('title inherits exact canonical range only; partial/wider/null/ambiguous titles do not inherit', async () => {
  const content = 'abcdef', doc = parseDocument(archiveDocument({ ...text, content }))
  const full = { from: 1, to: doc.content.size - 1 }, part = { from: 2, to: 4 }
  const prepare = (range, semanticMarkup) => prepareArchiveSnapshot('u', source(range), { ...text, content, semanticMarkup }, day)
  assert.equal((await prepare({ from: 0, to: doc.content.size }, [title('a', 'Name', full)])).snapshot.title, 'Name')
  assert.equal((await prepare(part, [title('a', 'Name', full)])).snapshot.title, undefined)
  assert.equal((await prepare(full, [title('a', 'Name', part), title('b', 'Null', null)])).snapshot.title, undefined)
  assert.equal((await prepare(full, [title('a', 'One', full), title('b', 'Two', full)])).snapshot.title, undefined)
  assert.equal((await prepare(full, [title('a', 'Same', full), title('b', 'Same', full)])).snapshot.title, 'Same')
})

test('invalid coordinates, owner, identity, revision, content/document, marks and source types fail closed', async () => {
  for (const patch of [{ sourceType: 'project' }, { coordinateVersion: 2 }, { sourceRevision: 1 },
    { archive: { userDayId: 'other', dayKey: day.dayKey } }, { range: { from: -1, to: 3 } }, { range: { from: 2, to: 2 } }]) {
    await assert.rejects(prepareArchiveSnapshot('u', { ...source({ from: 1, to: 3 }), ...patch }, text, day))
  }
  await assert.rejects(prepareArchiveSnapshot('other', source({ from: 1, to: 3 }), text, day))
  await assert.rejects(prepareArchiveSnapshot('u', source({ from: 1, to: 3 }), text, { ...day, userId: 'other' }))
  const rich = { ...text, document: legacyToDocument('abc'), contentFormat: 'tiptap-json', contentVersion: 1 }
  await assert.rejects(prepareArchiveSnapshot('u', source({ from: 1, to: 3 }), rich, day), /mismatch/)
  rich.document.content[0].content[0].marks = [{ type: 'public' }]
  await assert.rejects(prepareArchiveSnapshot('u', source({ from: 1, to: 3 }), rich, day), /форматирование/)
})

test('duplicate identity is extensible by sourceType, independent of source revision or text hash', () => {
  const record = { userId: 'u', channel: 'feed', source: { sourceType: 'archive', sourceId: 's', range: { from: 1, to: 5 } } }
  assert.notDeepEqual(publicationDuplicateKey(record), publicationDuplicateKey({ ...record, source: { ...record.source, sourceType: 'project' } }))
})

test('rich document with horizontalRule and empty paragraphs preserves selected structure without source edits', async () => {
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
    { type: 'horizontalRule' }, { type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }
  const record = { ...text, content: 'a\n\n\nb', contentFormat: 'tiptap-json', contentVersion: 1, document }
  const before = structuredClone(record)
  const result = await prepareArchiveSnapshot('u', source({ from: 0, to: parseDocument(document).content.size }), record, day)
  assert.deepEqual(result.snapshot.document, document)
  assert.equal(result.snapshot.content, record.content)
  assert.deepEqual(record, before)
})

test('empty days and selections consisting solely of a structural separator do not create empty snapshots', async () => {
  const record = { ...text, content: '' }, doc = parseDocument(archiveDocument(record))
  await assert.rejects(prepareArchiveSnapshot('u', source({ from: 0, to: doc.content.size }), record, day), /Empty/)
})
