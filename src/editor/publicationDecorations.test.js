import test from 'node:test'
import assert from 'node:assert/strict'
import { legacyToDocument, parseDocument } from './document.js'
import { publicationDecorations } from './publicationDecorations.js'

const record = { textId: 't', userId: 'u', revision: 7, content: 'alpha beta gamma' }
const publication = { publicationId: 'p', userId: 'u', source: { sourceType: 'archive', sourceId: 't', range: { from: 1, to: 6 } },
  liveAnchor: { publicationId: 'p', userId: 'u', sourceType: 'archive', sourceId: 't', coordinateVersion: 1,
    sourceRevision: 7, status: 'attached', range: { from: 7, to: 11 } } }
const doc = parseDocument(legacyToDocument(record.content))
test('publication highlight uses only attached live coordinates, leaving the document immutable', () => {
  const before = doc.toJSON(), highlights = publicationDecorations(doc, record, [publication], 'p').find()
  assert.deepEqual(highlights.map(d => ({ from: d.from, to: d.to, class: d.type.attrs.class })), [
    { from: 7, to: 11, class: 'archive-publication-highlight' },
  ])
  assert.deepEqual(doc.toJSON(), before)
})
test('missing, detached, stale, foreign and unsaved coordinates never fall back to historical range', () => {
  for (const patch of [{ liveAnchor: null }, { liveAnchor: { ...publication.liveAnchor, status: 'detached', range: null } },
    { liveAnchor: { ...publication.liveAnchor, sourceRevision: 6 } }, { userId: 'foreign' },
    { liveAnchor: { ...publication.liveAnchor, range: { from: 1, to: 99 } } }]) {
    assert.equal(publicationDecorations(doc, record, [{ ...publication, ...patch }], 'p').find().length, 0)
  }
  assert.equal(publicationDecorations(doc, record, [publication], null).find().length, 0)
  assert.equal(publicationDecorations(parseDocument(legacyToDocument('changed')), record, [publication], 'p').find().length, 0)
  assert.equal(publicationDecorations(doc, record, [], 'p').find().length, 0)
})
