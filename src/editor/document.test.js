import { test } from 'node:test'
import assert from 'node:assert/strict'
import { legacyToDocument, documentToContent, isDocumentEmpty, documentFromRecord, parseDocument } from './document.js'
import { getWordCount } from '../domain/wordCount.js'
const p = (...content) => ({ type: 'paragraph', ...(content.length ? { content } : {}) })
const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const doc = (...content) => ({ type: 'doc', content })

test('legacy conversion preserves literal markup, blank lines and trailing lines; normalizes CRLF', () => {
  const source = '**слово**\r\n\r\n__слово__ #осень <tag> ----\n'
  const record = { content: source, revision: 7, textId: 'legacy' }
  const before = structuredClone(record)
  const converted = documentFromRecord(record)
  assert.equal(documentToContent(converted), source.replaceAll('\r\n', '\n'))
  assert.equal(converted.content.length, 4)
  assert.deepEqual(record, before)
  assert.equal(converted.content[0].content[0].marks, undefined)
})
test('projection separates paragraphs, empty paragraphs, hard breaks and rules, excluding marks', () => {
  const value = doc(p(text('Один', [{ type: 'bold' }])), p(), p(text('Два'), { type: 'hardBreak' }, text('Три')), { type: 'horizontalRule' }, p(text('Четыре')))
  assert.equal(documentToContent(value), 'Один\n\nДва\nТри\n\nЧетыре')
  assert.equal(getWordCount(documentToContent(value)), 4)
})
test('semantic emptiness ignores technical paragraphs, whitespace and external semantic markup', () => {
  for (const value of [doc(p()), doc(p(text(' \t\u00a0'), { type: 'hardBreak' }), p())]) assert.equal(isDocumentEmpty(value), true)
  assert.equal(isDocumentEmpty(doc({ type: 'horizontalRule' }, p())), false)
  assert.equal(getWordCount(documentToContent(doc({ type: 'horizontalRule' }, p()))), 0)
  assert.equal(isDocumentEmpty(legacyToDocument('#заметки')), false)
  const record = { contentFormat: 'tiptap-json', contentVersion: 1, document: doc(p()), content: 'stale', semanticMarkup: [{ kind: 'tag', value: 'не авторский текст', range: null }] }
  assert.equal(isDocumentEmpty(documentFromRecord(record)), true)
  assert.equal(documentToContent(documentFromRecord(record)), '')
})
test('rich document is authoritative, roundtrips and returns detached JSON', () => {
  const record = { contentFormat: 'tiptap-json', contentVersion: 1, document: doc(p(text('Автор', [{ type: 'underline' }]))), content: 'stale' }
  const result = documentFromRecord(record)
  assert.equal(documentToContent(result), 'Автор')
  assert.deepEqual(result, record.document)
  result.content[0].content[0].text = 'Изменено'
  assert.equal(record.document.content[0].content[0].text, 'Автор')
})
test('unknown format/version and malformed rich JSON fail instead of falling back or dropping data', () => {
  for (const record of [{ contentFormat: 'html', content: 'fallback' }, { contentFormat: 'tiptap-json', contentVersion: 2 }, { contentFormat: 'tiptap-json', contentVersion: 1 }]) assert.throws(() => documentFromRecord(record))
  for (const value of [doc(), doc({ type: 'heading' }), doc(text('outside paragraph')), doc(p(text('x', [{ type: 'link' }]))), { ...doc(p()), attrs: { hidden: true } }]) assert.throws(() => parseDocument(value))
})
