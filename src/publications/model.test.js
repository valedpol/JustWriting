import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareArchiveSnapshot } from './archiveSource.js'
import { makePublication, feedPublicationProjection } from './model.js'

const text = { textId: 't', userId: 'u', userDayId: 'd', dayKey: '2026-10-07', revision: 1, content: 'abc' }
const day = { userDayId: 'd', userId: 'u', dayKey: text.dayKey }
const request = { sourceType: 'archive', sourceId: 't', sourceRevision: 1, coordinateVersion: 1,
  range: { from: 1, to: 4 }, archive: { userDayId: 'd', dayKey: text.dayKey } }
const profile = { userId: 'u', displayName: 'Name' }

async function attributes() {
  return { publicationId: 'p', userId: 'u', channel: 'feed', publishedAt: 1,
    prepared: await prepareArchiveSnapshot('u', request, text, day), profile }
}

test('model copies only public snapshot fields, freezes nested values and does not retain caller references', async () => {
  const input = await attributes()
  input.prepared.snapshot.semanticMarkup = [{ private: true }]
  input.prepared.snapshot.selection = { from: 1, to: 4 }
  const record = makePublication(input)
  input.prepared.snapshot.document.content[0].content[0].text = 'bad'
  input.prepared.source.range.to = 2
  input.profile.displayName = 'Different'
  assert.equal(record.snapshot.document.content[0].content[0].text, 'abc')
  assert.equal(record.source.range.to, 4)
  assert.equal(record.author.displayName, 'Name')
  assert.equal('semanticMarkup' in record.snapshot, false)
  assert.equal('selection' in record.snapshot, false)
  assert.throws(() => { record.source.range.to = 3 }, TypeError)
  assert.throws(() => { record.snapshot.document.content.push({}) }, TypeError)
})

test('invalid model identity, source fields, snapshot or author inputs are rejected', async () => {
  const input = await attributes()
  for (const patch of [{ publicationId: '' }, { userId: '' }, { channel: 'other' }, { publishedAt: NaN }, { publishedAt: -1 },
    { profile: { userId: 'other', displayName: 'Other' } }, { settings: { userId: 'other', authorVisibility: 'visible' } },
    { settings: { userId: 'u', authorVisibility: 'invalid' } }]) assert.throws(() => makePublication({ ...input, ...patch }))
  for (const patch of [{ sourceType: 'project' }, { contentSha256: 'bad' }, { sourceRevision: -1 }, { range: { from: 4, to: 1 } }, { coordinateVersion: 2 }]) {
    assert.throws(() => makePublication({ ...input, prepared: { ...input.prepared, source: { ...input.prepared.source, ...patch } } }))
  }
  for (const patch of [{ content: 'different' }, { content: '' }, { contentFormat: 'html' }, { contentVersion: 2 }, { title: '' }]) {
    assert.throws(() => makePublication({ ...input, prepared: { ...input.prepared, snapshot: { ...input.prepared.snapshot, ...patch } } }))
  }
})

test('Profile ignores visibility; hidden reader projection has neither identity nor provenance', async () => {
  const input = await attributes()
  const own = makePublication({ ...input, settings: { userId: 'u', authorVisibility: 'hidden' } })
  const reader = feedPublicationProjection(own)
  assert.equal(reader.authorVisibility, 'hidden')
  assert.equal('author' in reader, false); assert.equal('userId' in reader, false); assert.equal('source' in reader, false)
  const profileRecord = makePublication({ ...input, channel: 'profile', profile: undefined, settings: { authorVisibility: 'invalid' } })
  assert.equal('authorVisibility' in profileRecord, false); assert.equal('author' in profileRecord, false)
})

test('reader projection allowlists fields even if restored records contain extra private snapshot/author metadata', async () => {
  const input = await attributes(), record = structuredClone(makePublication(input))
  record.snapshot.semanticMarkup = [{ secret: true }]
  record.snapshot.tags = ['Private']
  record.author.deviceId = 'Private'
  const reader = feedPublicationProjection(record)
  assert.equal('semanticMarkup' in reader.snapshot, false)
  assert.equal('tags' in reader.snapshot, false)
  assert.equal('deviceId' in reader.author, false)
})
