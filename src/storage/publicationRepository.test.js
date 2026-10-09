import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { connectDatabase } from './database.js'
import { createPublicationRepository } from './publicationRepository.js'
import { createPublicIdentityRepository } from './publicIdentityRepository.js'
import { createArchiveSourceAdapter } from './archiveSourceAdapter.js'
import { legacyToDocument, parseDocument } from '../editor/document.js'
import { bytesHash } from '../utils/files.js'
import { captureBackup, restoreToNewDatabase, verifyRestoredDatabase } from '../backup/backup.js'

globalThis.IDBKeyRange = IDBKeyRange
const users = ['user-a', 'user-b', 'user-c']
const names = ['settings', 'texts', 'userDays', 'wordCountSamples', 'publications']
async function fixture() {
  const factory = new IDBFactory(), name = `jw-publication-${crypto.randomUUID()}`
  let db = await connectDatabase({ factory, name })
  const runTransaction = (stores, mode, run) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let result, failure
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(failure || tx.error)
    tx.onerror = () => {}
    try { run(tx, value => { result = value }, error => { failure = error; tx.abort() }) }
    catch (error) { failure = error; tx.abort() }
  })
  const texts = users.map((userId, i) => ({ textId: `text-${i}`, userId, userDayId: `day-${i}`, dayKey: '2026-10-07',
    revision: 3, content: 'alpha beta gamma', contentFormat: 'tiptap-json', contentVersion: 1,
    document: legacyToDocument('alpha beta gamma'), semanticMarkup: [], unknown: { missing: undefined, nil: null, bytes: new Uint8Array([1, 2]) } }))
  texts[0].document.content[0].content[0].marks = [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }]
  texts[0].semanticMarkup = [{ id: 'tag', valueId: 'tag', value: 'Private', kind: 'tag', source: 'selection', direction: 'backward', anchor: 6, range: { from: 1, to: 6 } }]
  await runTransaction(names, 'readwrite', tx => {
    texts.forEach(text => {
      tx.objectStore('texts').add(text)
      tx.objectStore('userDays').add({ userDayId: text.userDayId, userId: text.userId, dayKey: text.dayKey, revision: 1,
        startsAt: 10, endsAt: 20, timeZone: 'Europe/Moscow', policyVersion: 10 })
      tx.objectStore('wordCountSamples').add({ sampleId: text.userId, userDayId: text.userDayId, timestamp: 12, wordCount: 3 })
    })
    tx.objectStore('settings').add({ key: 'localProfile', userId: users[0], displayName: 'Alice', createdAt: 1 })
  })
  const all = () => runTransaction(names, 'readonly', (tx, done) => {
    const data = {}; done(data)
    for (const store of names) {
      const read = tx.objectStore(store).getAll(); read.onsuccess = () => { data[store] = read.result }
    }
  })
  const profile = (userId, authorVisibility) => runTransaction(['settings'], 'readwrite', tx => {
    tx.objectStore('settings').put({ key: 'localProfile', userId, displayName: `Name ${userId}`, createdAt: 1 })
    if (authorVisibility) {
      const read = tx.objectStore('settings').get(`publicProfile:${userId}`)
      read.onsuccess = () => tx.objectStore('settings').put({ ...read.result, key: `publicProfile:${userId}`, userId, authorVisibility })
    }
  })
  const identities = createPublicIdentityRepository({ runTransaction })
  for (const userId of users) await identities.loadPublicIdentity(userId)
  const repo = createPublicationRepository({ runTransaction, flush: async () => {}, now: () => 100 })
  const source = (i = 0, range = { from: 0, to: parseDocument(texts[i].document).content.size }) => ({
    sourceType: 'archive', sourceId: texts[i].textId, sourceRevision: 3, coordinateVersion: 1, range,
    archive: { userDayId: texts[i].userDayId, dayKey: texts[i].dayKey } })
  return { factory, name, texts, runTransaction, repo, all, profile, source,
    close: () => db.close(),
    reopen: async () => { db.close(); db = await connectDatabase({ factory, name }) } }
}
const create = (f, channels = ['profile'], i = 0, range) => f.repo.createPublications(users[i], { source: f.source(i, range), channels })
const originalStores = data => Object.fromEntries(names.filter(n => n !== 'publications').map(n => [n, data[n]]))

test('one source, three independent immutable channel snapshots; create/delete/reopen preserve all source stores', async t => {
  const f = await fixture(); t.after(f.close)
  const before = await f.all(), records = await create(f, ['profile', 'feed', 'internet'])
  assert.equal(new Set(records.map(p => p.publicationId)).size, 3)
  assert.equal('authorVisibility' in records[0], false)
  assert.equal(records[1].authorVisibility, 'visible')
  assert.equal('semanticMarkup' in records[0].snapshot, false)
  assert.equal(records[0].snapshot.content, f.texts[0].content)
  assert.equal(records[0].snapshot.document.content[0].content[0].marks.length, 3)
  assert.equal(records[0].source.contentSha256, await bytesHash(new TextEncoder().encode(f.texts[0].content)))
  assert.throws(() => { records[0].snapshot.content = 'bad' }, TypeError)
  assert.notEqual(records[0].snapshot, records[1].snapshot)
  assert.deepEqual(originalStores(await f.all()), originalStores(before))
  await f.repo.deletePublication(users[0], records[1].publicationId)
  assert.equal((await f.repo.listOwnPublications(users[0], 'profile')).length, 1)
  assert.equal((await f.repo.listOwnPublications(users[0], 'internet')).length, 1)
  assert.equal((await f.repo.listFeedPublications()).length, 0)
  assert.deepEqual(originalStores(await f.all()), originalStores(before))
  const expected = await f.all(); await f.reopen(); assert.deepEqual(await f.all(), expected)
  assert.deepEqual(await f.repo.listOwnPublications(users[0], 'profile'), [records[0]])
})

test('exact duplicate (including AllSelection/mouse equivalence) rejects atomically; overlaps and nesting allowed', async t => {
  const f = await fixture(); t.after(f.close)
  await create(f, ['feed'])
  const before = await f.all()
  await assert.rejects(create(f, ['profile', 'feed']), { name: 'ConstraintError' })
  assert.deepEqual(await f.all(), before, 'first channel add must roll back')
  await assert.rejects(create(f, ['feed'], 0, { from: 1, to: 17 }), { name: 'ConstraintError' })
  for (const range of [{ from: 1, to: 6 }, { from: 2, to: 5 }, { from: 4, to: 9 }]) await create(f, ['feed'], 0, range)
  assert.equal((await f.repo.listFeedPublications()).length, 4)
  const results = await Promise.allSettled([create(f, ['internet']), create(f, ['internet'])])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.deepEqual(originalStores(await f.all()), originalStores(before))
})

test('republish after delete gets new ID/date; duplicate does not depend on source revision', async t => {
  const f = await fixture(); t.after(f.close)
  const [first] = await create(f)
  await f.runTransaction(['texts'], 'readwrite', tx => tx.objectStore('texts').put({ ...f.texts[0], revision: 4 }))
  await assert.rejects(f.repo.createPublications(users[0], { source: { ...f.source(), sourceRevision: 4 }, channels: ['profile'] }), { name: 'ConstraintError' })
  await f.repo.deletePublication(users[0], first.publicationId)
  const nextRepo = createPublicationRepository({ runTransaction: f.runTransaction, flush: async () => {}, now: () => 101 })
  const [next] = await nextRepo.createPublications(users[0], { source: { ...f.source(), sourceRevision: 4 }, channels: ['profile'] })
  assert.notEqual(next.publicationId, first.publicationId); assert.equal(next.publishedAt, 101)
})

test('three users combine in reader Feed, stable newest-first order, private provenance and hidden identity excluded', async t => {
  const f = await fixture(); t.after(f.close)
  for (let i = 0; i < 3; i++) {
    await f.profile(users[i], i === 1 ? 'hidden' : 'visible')
    await create(f, ['profile', 'feed', 'internet'], i)
  }
  const full = (await f.all()).publications.filter(p => p.channel === 'feed')
  const feed = await f.repo.listFeedPublications()
  assert.equal(feed.length, 3)
  assert.deepEqual(feed.map(p => p.publicationId), full.map(p => p.publicationId).sort())
  assert.equal(feed.filter(p => p.authorVisibility === 'hidden').length, 1)
  for (const p of feed) {
    assert.equal('source' in p, false); assert.equal('userId' in p, false)
    if (p.authorVisibility === 'hidden') assert.equal('author' in p, false)
    else {
      assert.equal('userId' in p.author, false)
      assert.match(p.author.displayName, /^Автор-[0-9A-HJKMNP-TV-Z]{4}$/)
    }
  }
  for (const user of users) assert.equal((await f.repo.listOwnPublications(user, 'feed')).length, 1)
  await f.profile(users[0], 'hidden')
  assert.deepEqual(await f.repo.listFeedPublications(), feed, 'feed independent of active user/settings')
  await assert.rejects(f.repo.deletePublication(users[0], full.find(p => p.userId === users[1]).publicationId), /owner/)
  await f.repo.deletePublication(users[1], full.find(p => p.userId === users[1]).publicationId)
  assert.equal((await f.repo.listOwnPublications(users[1], 'feed')).length, 0)
  assert.equal((await f.repo.listFeedPublications()).length, 2)
  const later = createPublicationRepository({ runTransaction: f.runTransaction, flush: async () => {}, now: () => 102 })
  await later.createPublications(users[0], { source: f.source(0, { from: 1, to: 5 }), channels: ['feed'] })
  assert.equal((await f.repo.listFeedPublications())[0].publishedAt, 102)
})

test('live public nicknames update every visible publication without rewriting snapshots; hidden identity remains excluded and aliases survive reopen/backup', async t => {
  const f = await fixture(); t.after(f.close)
  const identities = createPublicIdentityRepository({ runTransaction: f.runTransaction })
  for (let i = 0; i < 3; i++) {
    await f.profile(users[i], i === 1 ? 'hidden' : 'visible')
    await identities.savePublicNickname(users[i], i === 1 ? 'Hidden nickname' : `Nickname ${i}`)
    await create(f, ['profile', 'feed', 'internet'], i)
  }
  await f.profile(users[0], 'visible')
  await create(f, ['feed'], 0, { from: 1, to: 6 })
  const original = await f.all()
  const ownFeedIds = original.publications.filter(p => p.channel === 'feed' && p.userId === users[0]).map(p => p.publicationId)
  const fallback = (await identities.loadPublicIdentity(users[0])).alias
  await identities.savePublicNickname(users[0], '  Updated nickname  ')
  let feed = await f.repo.listFeedPublications()
  for (const item of feed) {
    if (ownFeedIds.includes(item.publicationId)) assert.equal(item.author.displayName, 'Updated nickname')
    else if (item.authorVisibility === 'visible') assert.equal(item.author.displayName, 'Nickname 2')
    else assert.equal('author' in item, false)
    assert.equal('userId' in item, false)
    if (item.author) assert.deepEqual(Object.keys(item.author), ['publicId', 'displayName', 'allowNameDisclosure', 'profileVisible', 'displayLabel'])
  }
  assert.equal(JSON.stringify(feed).includes('Hidden nickname'), false)
  assert.equal(JSON.stringify(feed).includes('Name user-'), false)
  const publicId = (await identities.loadPublicIdentity(users[0])).publicId
  await identities.savePublicIdentitySetting(users[0], 'allowNameDisclosure', true)
  const disclosed = await f.repo.listFeedPublications()
  for (const item of disclosed.filter(p => ownFeedIds.includes(p.publicationId))) {
    assert.equal(item.author.publicId, publicId)
    assert.equal(item.author.displayLabel, 'Updated nickname ›')
    assert.equal('fullName' in item.author, false)
  }
  feed = disclosed
  const saved = await f.all()
  for (const store of names.filter(n => n !== 'settings')) assert.deepEqual(saved[store], original[store])
  assert.deepEqual(saved.settings.find(s => s.key === 'localProfile'), original.settings.find(s => s.key === 'localProfile'))
  await assert.rejects(identities.savePublicNickname(users[2], 'Not owner'), /Профиль изменился/)
  await f.reopen()
  assert.equal((await identities.loadPublicIdentity(users[0])).nickname, 'Updated nickname')
  assert.deepEqual(await f.repo.listFeedPublications(), feed)
  const factory = { open: (name, version) => f.factory.open(name === 'just-writing' ? f.name : name, version),
    databases: async () => (await f.factory.databases()).map(d => ({ ...d, name: d.name === f.name ? 'just-writing' : d.name })),
    deleteDatabase: name => f.factory.deleteDatabase(name) }
  const backup = await captureBackup({ factory, flush: async () => {}, origin: 'https://test.invalid' })
  const restored = await restoreToNewDatabase(backup, { factory })
  assert.equal((await verifyRestoredDatabase(backup, restored, { factory })).verified, true)
  assert.deepEqual(await f.all(), saved)
  await identities.savePublicNickname(users[0], '')
  assert.ok((await f.repo.listFeedPublications()).filter(p => ownFeedIds.includes(p.publicationId)).every(p => p.author.displayName === fallback))
})

test('source edits and author/settings changes never change existing snapshots; Profile ignores author visibility', async t => {
  const f = await fixture(); t.after(f.close)
  const [p, feed] = await create(f, ['profile', 'feed'])
  await f.profile(users[0], 'hidden')
  await f.runTransaction(['texts'], 'readwrite', tx => tx.objectStore('texts').put({ ...f.texts[0], content: 'changed',
    document: legacyToDocument('changed'), revision: 4, semanticMarkup: [] }))
  assert.deepEqual(await f.repo.listOwnPublications(users[0], 'profile'), [p])
  assert.deepEqual(await f.repo.listOwnPublications(users[0], 'feed'), [feed])
  const [next] = await f.repo.createPublications(users[0], { source: { ...f.source(), sourceRevision: 4, range: { from: 1, to: 4 } }, channels: ['feed'] })
  assert.equal(next.authorVisibility, 'hidden')
})

test('adapter flushes before reading; failed flush, stale revision, other owner and unsupported source produce zero writes', async t => {
  const f = await fixture(); t.after(f.close)
  const before = await f.all()
  const failing = createPublicationRepository({ runTransaction: f.runTransaction, flush: async () => { throw new Error('unsaved') } })
  await assert.rejects(failing.createPublications(users[0], { source: f.source(), channels: ['profile'] }), /unsaved/)
  for (const patch of [{ sourceRevision: 2 }, { sourceType: 'project' }, { sourceId: 'absent' }, { coordinateVersion: 2 }]) {
    await assert.rejects(f.repo.createPublications(users[0], { source: { ...f.source(), ...patch }, channels: ['profile'] }))
  }
  await assert.rejects(f.repo.createPublications(users[1], { source: f.source(), channels: ['profile'] }), /owner/)
  await assert.rejects(create(f, ['profile', 'profile']), /channels/)
  await assert.rejects(create(f, ['unknown']), /channels/)
  assert.deepEqual(await f.all(), before)
  const ordering = []
  const adapter = createArchiveSourceAdapter({ runTransaction: (...args) => { ordering.push('read'); return f.runTransaction(...args) }, flush: async () => { ordering.push('flush') } })
  await adapter.prepare(users[0], f.source())
  assert.deepEqual(ordering, ['flush', 'read'])
  const missingFlush = createPublicationRepository({ runTransaction: f.runTransaction })
  await assert.rejects(missingFlush.createPublications(users[0], { source: f.source(), channels: ['profile'] }), /flush/)
})

for (const patch of [{ revision: 4 }, { content: 'tampered' }, { semanticMarkup: [] }]) {
  test(`transaction boundary detects concurrent source mutation ${JSON.stringify(patch)} before add`, async t => {
    const f = await fixture(); t.after(f.close)
    const runTransaction = async (stores, mode, run) => {
      if (stores.includes('publications') && mode === 'readwrite') {
        await f.runTransaction(['texts'], 'readwrite', tx => tx.objectStore('texts').put({ ...f.texts[0], ...patch }))
      }
      return f.runTransaction(stores, mode, run)
    }
    const repo = createPublicationRepository({ runTransaction, flush: async () => {} })
    await assert.rejects(repo.createPublications(users[0], { source: f.source(), channels: ['profile'] }), /conflict|changed/)
    assert.equal((await f.all()).publications.length, 0)
  })
}

test('actual repository-created publications survive backup v2 UUID restore/reopen/compare', async t => {
  const f = await fixture(); t.after(f.close)
  await create(f, ['profile', 'feed', 'internet'])
  const before = await f.all()
  const factory = { open: (name, version) => f.factory.open(name === 'just-writing' ? f.name : name, version),
    databases: async () => (await f.factory.databases()).map(d => ({ ...d, name: d.name === f.name ? 'just-writing' : d.name })),
    deleteDatabase: name => f.factory.deleteDatabase(name) }
  const backup = await captureBackup({ factory, flush: async () => {}, origin: 'https://test.invalid' })
  const restored = await restoreToNewDatabase(backup, { factory })
  const result = await verifyRestoredDatabase(backup, restored, { factory })
  assert.equal(result.verified, true)
  assert.deepEqual(await f.all(), before)
})

test('flush re-read detects a save advancing revision; mutation of caller request during flush cannot change publication', async t => {
  const f = await fixture(); t.after(f.close)
  const repo = createPublicationRepository({ runTransaction: f.runTransaction, flush: () => f.runTransaction(['texts'], 'readwrite',
    tx => tx.objectStore('texts').put({ ...f.texts[0], revision: 4 })) })
  await assert.rejects(repo.createPublications(users[0], { source: f.source(), channels: ['profile'] }), /revision/)
  assert.equal((await f.all()).publications.length, 0)
  const source = { ...f.source(), sourceRevision: 4 }, channels = ['profile']
  const safe = createPublicationRepository({ runTransaction: f.runTransaction, flush: async () => {
    source.range.from = 3; channels.push('feed')
  } })
  const [record] = await safe.createPublications(users[0], { source, channels })
  assert.equal(record.snapshot.content, f.texts[0].content)
  assert.equal((await f.all()).publications.length, 1)
})

test('invalid Feed settings abort all channels; Profile never reads visibility as its own state', async t => {
  const f = await fixture(); t.after(f.close)
  await f.profile(users[0], 'invalid')
  await assert.rejects(create(f, ['profile', 'feed']), /settings/)
  assert.equal((await f.all()).publications.length, 0)
  const [profile] = await create(f)
  assert.equal('authorVisibility' in profile, false)
  assert.equal('author' in profile, false)
  const before = await f.all()
  await f.profile(users[1])
  const mismatch = await f.all()
  await assert.rejects(create(f, ['internet']), /profile/)
  assert.deepEqual(await f.all(), mismatch)
  assert.deepEqual(mismatch.publications, before.publications)
})

test('unique storage constraint separates future project source from archive without implementing project adapter', async t => {
  const f = await fixture(); t.after(f.close)
  const [archive] = await create(f)
  const fixtureProject = { ...structuredClone(archive), publicationId: 'future-project-fixture', source: { ...archive.source, sourceType: 'project' } }
  await f.runTransaction(['publications'], 'readwrite', tx => tx.objectStore('publications').add(fixtureProject))
  assert.equal((await f.all()).publications.length, 2)
  await assert.rejects(f.repo.createPublications(users[0], { source: { ...f.source(), sourceType: 'project' }, channels: ['feed'] }), /Unsupported/)
})

test('default repository uses registered live flush and production transaction boundary on an isolated UUID database', async t => {
  const f = await fixture(); t.after(f.close)
  // The logical production name is mapped to a fresh fake UUID DB, never a browser DB.
  globalThis.indexedDB = { open: (_name, version) => f.factory.open(f.name, version) }
  const { maintenance } = await import('../runtime/maintenance.js')
  const { createPublications, listOwnPublications, deletePublication } = await import('./publicationRepository.js')
  const { openDatabase } = await import('./database.js')
  let flushes = 0
  const unregister = maintenance.registerFlush(async () => { flushes++ })
  t.after(unregister)
  const before = await f.all()
  const [record] = await createPublications(users[0], { source: f.source(), channels: ['profile'] })
  assert.equal(flushes, 1)
  assert.deepEqual(await listOwnPublications(users[0], 'profile'), [record])
  await deletePublication(users[0], record.publicationId)
  assert.deepEqual(await f.all(), before)
  const connection = await openDatabase()
  connection.close()
})


test('legacy authors initialize random public identity once on reader lookup without changing publications or source stores', async t => {
  const f = await fixture(); t.after(f.close)
  await create(f, ['feed'])
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').delete(`publicProfile:${users[0]}`))
  const before = await f.all()
  const feed = await f.repo.listFeedPublications()
  assert.match(feed[0].author.displayName, /^Автор-[0-9A-HJKMNP-TV-Z]{4}$/)
  assert.equal(feed[0].author.allowNameDisclosure, false)
  const initialized = await f.all()
  for (const store of names.filter(n => n !== 'settings')) assert.deepEqual(initialized[store], before[store])
  assert.deepEqual(initialized.settings.find(s => s.key === 'localProfile'), before.settings.find(s => s.key === 'localProfile'))
  await f.reopen()
  assert.deepEqual(await f.repo.listFeedPublications(), feed)
  assert.deepEqual(await f.all(), initialized)
})
