import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { connectDatabase } from './database.js'
import { createReaderFeedFixture } from '../testFixtures/readerFeed.js'
import { createPublicProfileRepository } from './publicProfileRepository.js'
import { createPublicationRepository } from './publicationRepository.js'
import { captureBackup, restoreToNewDatabase, verifyRestoredDatabase } from '../backup/backup.js'

globalThis.IDBKeyRange = IDBKeyRange
const stores = ['settings', 'texts', 'userDays', 'wordCountSamples', 'publications']
async function fixture(t) {
  const factory = new IDBFactory(), name = `profile-test-${crypto.randomUUID()}`
  let db = await connectDatabase({ factory, name })
  const accesses = []
  const runTransaction = (names, mode, run) => new Promise((resolve, reject) => {
    accesses.push({ names, mode })
    const tx = db.transaction(names, mode); let result, failure
    tx.oncomplete = () => resolve(result); tx.onabort = () => reject(failure || tx.error); tx.onerror = () => {}
    try { run(tx, value => { result = value }, error => { failure = error; tx.abort() }) } catch (error) { failure = error; tx.abort() }
  })
  const data = await createReaderFeedFixture({ runTransaction })
  const dump = () => runTransaction(stores, 'readonly', (tx, done) => {
    const values = {}; done(values)
    for (const store of stores) { const request = tx.objectStore(store).getAll(); request.onsuccess = () => { values[store] = request.result } }
  })
  const change = (i, patch) => runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ ...data.publicProfiles[i], ...patch }))
  t.after(() => db.close())
  return { ...data, factory, name, runTransaction, accesses, dump, change, reopen: async () => { db.close(); db = await connectDatabase({ factory, name }) } }
}

test('owner and foreign profiles are readonly, snapshot-only cards; public projections omit private data and filter channel/author', async t => {
  const f = await fixture(t), before = await f.dump()
  f.accesses.length = 0
  const foreign = await f.profileRepo.loadPublicProfile(f.publicProfiles[2].publicId)
  assert.equal(foreign.publications.length, 1)
  assert.equal(foreign.fullName, 'Current fixture name 2')
  assert.equal(foreign.stats.joinedAt, null)
  assert.equal(foreign.stats.writingDays, 14)
  assert.ok(f.accesses.every(access => access.mode === 'readonly' && !access.names.includes('texts') && !access.names.includes('userDays')))
  const own = await f.profileRepo.loadPublicProfile(f.publicProfiles[0].publicId)
  assert.equal(own.displayName, 'Mumipol')
  assert.deepEqual(own.stats, { joinedAt: Date.UTC(2026, 8, 1), writingDays: 1, totalWords: 4 })
  assert.equal(own.publications.length, 1)
  assert.equal(own.publications[0].snapshot.title, 'Snapshot title')
  assert.equal(own.publications[0].snapshot.document.content[0].content[0].marks.length, 3)
  for (const value of [own, foreign]) for (const secret of [...f.users, 'PRIVATE TAG', 'HISTORICAL NAME', ...f.texts.map(row => row.textId)]) assert.equal(JSON.stringify(value).includes(secret), false)
  assert.deepEqual(await f.dump(), before)
  await f.runTransaction(['texts'], 'readwrite', tx => tx.objectStore('texts').put({ ...f.texts[0], content: 'Updated private source', revision: 99 }))
  const after = await f.profileRepo.loadPublicProfile(f.publicProfiles[0].publicId)
  assert.deepEqual(after.publications, own.publications)
  assert.throws(() => { after.publications[0].snapshot.content = 'changed' }, TypeError)
})

test('profile visibility, disclosure, anonymous Feed and fallback alias are independent; hidden/unknown profiles return null', async t => {
  const f = await fixture(t), id = f.publicProfiles[1].publicId
  assert.equal(await f.profileRepo.loadPublicProfile(id), null)
  assert.equal(await f.profileRepo.loadPublicProfile('unknown'), null)
  assert.equal(await f.profileRepo.loadPublicAuthorStats(undefined), null)
  await f.change(1, { profileVisible: true })
  const profile = await f.profileRepo.loadPublicProfile(id)
  assert.equal(profile.displayName, f.publicProfiles[1].publicAlias)
  assert.equal(profile.fullName, null)
  assert.deepEqual(profile.publications, [])
  assert.deepEqual(profile.links, [])
  const hiddenFeed = (await f.repo.listReaderFeedPublications(f.users[0])).find(row => row.authorVisibility === 'hidden')
  assert.equal('author' in hiddenFeed, false)
  assert.ok(await f.profileRepo.loadPublicProfile(f.publicProfiles[0].publicId))
  await f.change(0, { profileVisible: false, allowNameDisclosure: true })
  assert.equal(await f.profileRepo.loadPublicProfile(f.publicProfiles[0].publicId), null)
})

test('profile settings persist without schema changes, preserve unknown fields/source/snapshots and survive backup v2 restore/reopen/compare', async t => {
  const f = await fixture(t), original = await f.dump(), id = f.publicProfiles[0].publicId
  await f.change(0, { unknown: { preserve: true } })
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'profileVisible', true)
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'about', '🙂'.repeat(300))
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'links', [{ label: 'Telegram', url: 'https://t.me/example' }])
  const pinned = original.publications.find(record => record.userId === f.users[0] && record.channel === 'profile')
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', pinned.publicationId)
  await f.identityRepo.savePublicNickname(f.users[0], 'Polevoy')
  const updated = await f.dump()
  for (const store of stores.filter(name => name !== 'settings')) assert.deepEqual(updated[store], original[store])
  assert.deepEqual(updated.settings.find(row => row.key === 'localProfile'), original.settings.find(row => row.key === 'localProfile'))
  assert.deepEqual(updated.settings.find(row => row.publicId === id).unknown, { preserve: true })
  for (const [field, value] of [['profileVisible', 'yes'], ['about', 'x'.repeat(301)], ['links', [{ label: 'Unsafe', url: 'javascript:alert(1)' }]]]) await assert.rejects(f.identityRepo.savePublicIdentitySetting(f.users[0], field, value))
  await assert.rejects(f.identityRepo.savePublicIdentitySetting(f.users[1], 'profileVisible', true), /Профиль изменился/)
  assert.deepEqual(await f.dump(), updated)
  await f.reopen()
  const profile = await f.profileRepo.loadPublicProfile(id)
  assert.equal(profile.displayName, 'Polevoy')
  assert.equal(profile.about.length, 600)
  assert.equal(profile.pinnedPublicationId, pinned.publicationId)
  const factory = { open: (name, version) => f.factory.open(name === 'just-writing' ? f.name : name, version),
    databases: async () => (await f.factory.databases()).map(row => ({ ...row, name: row.name === f.name ? 'just-writing' : row.name })), deleteDatabase: name => f.factory.deleteDatabase(name) }
  const backup = await captureBackup({ factory, flush: async () => {}, origin: 'https://test.invalid' })
  assert.equal(JSON.parse(await backup.text()).formatVersion, 2)
  const restored = await restoreToNewDatabase(backup, { factory })
  assert.equal((await verifyRestoredDatabase(backup, restored, { factory })).verified, true)
  assert.deepEqual(await f.dump(), updated)
})

test('single profile pin is owner-validated, durable and independent of immutable snapshots; deletion falls back to chronological order', async t => {
  const f = await fixture(t)
  const older = (await f.repo.listOwnPublications(f.users[0], 'profile'))[0]
  const fragment = f.records.find(record => record.userId === f.users[0] && record.channel === 'feed' && record.snapshot.title === undefined)
  const [newer] = await f.repo.createPublications(f.users[0], { source: fragment.source, channels: ['profile'] })
  const before = await f.dump(), id = f.publicProfiles[0].publicId
  assert.deepEqual((await f.profileRepo.loadPublicProfile(id)).publications.map(row => row.publicationId), [newer.publicationId, older.publicationId])
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', older.publicationId)
  await f.reopen()
  let profile = await f.profileRepo.loadPublicProfile(id)
  assert.equal(profile.pinnedPublicationId, older.publicationId)
  assert.deepEqual(profile.publications.map(row => row.publicationId), [older.publicationId, newer.publicationId])
  assert.deepEqual(profile.publications[0].snapshot, older.snapshot)
  for (const publicationId of ['missing', f.records.find(row => row.userId !== f.users[0] && row.channel === 'profile').publicationId,
    f.records.find(row => row.userId === f.users[0] && row.channel === 'feed').publicationId]) {
    await assert.rejects(f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', publicationId), /только свою/)
    assert.equal((await f.profileRepo.loadPublicProfile(id)).pinnedPublicationId, older.publicationId)
  }
  await assert.rejects(f.identityRepo.savePublicIdentitySetting(f.users[1], 'pinnedPublicationId', older.publicationId), /Профиль изменился/)
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', newer.publicationId)
  profile = await f.profileRepo.loadPublicProfile(id)
  assert.equal(profile.pinnedPublicationId, newer.publicationId)
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', null)
  profile = await f.profileRepo.loadPublicProfile(id)
  assert.equal(profile.pinnedPublicationId, null)
  assert.deepEqual(profile.publications.map(row => row.publicationId), [newer.publicationId, older.publicationId])
  for (const store of stores.filter(name => name !== 'settings')) assert.deepEqual((await f.dump())[store], before[store])
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', older.publicationId)
  await f.repo.deletePublication(f.users[0], older.publicationId)
  const afterDelete = await f.dump()
  assert.equal(afterDelete.settings.find(row => row.publicId === id).pinnedPublicationId, null, 'delete clears stored pin atomically')
  await f.reopen()
  profile = await f.profileRepo.loadPublicProfile(id)
  assert.equal(profile.pinnedPublicationId, null)
  assert.deepEqual(profile.publications.map(row => row.publicationId), [newer.publicationId])
  assert.deepEqual(await f.dump(), afterDelete, 'reader never repairs a dangling pin by writing settings')
})

test('profile deletion and pin clearing roll back together; unrelated deletes and rejected foreign deletes preserve the pin', async t => {
  const f = await fixture(t), own = f.records.find(row => row.userId === f.users[0] && row.channel === 'profile')
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', own.publicationId)
  const before = await f.dump()
  const failing = createPublicationRepository({ runTransaction: (names, mode, run) => f.runTransaction(names, mode, (tx, done, fail) => {
    run(tx, value => { if (mode === 'readwrite') fail(new Error('Injected commit failure')); else done(value) }, fail)
  }) })
  await assert.rejects(failing.deletePublication(f.users[0], own.publicationId), /Injected commit failure/)
  assert.deepEqual(await f.dump(), before)
  const foreign = f.records.find(row => row.userId !== f.users[0] && row.channel === 'profile')
  await assert.rejects(f.repo.deletePublication(f.users[0], foreign.publicationId), /owner/)
  assert.deepEqual(await f.dump(), before)
  const feed = f.records.find(row => row.userId === f.users[0] && row.channel === 'feed')
  await f.repo.deletePublication(f.users[0], feed.publicationId)
  assert.equal(await f.profileRepo.loadOwnProfilePin(f.users[0]), own.publicationId)
  const hidden = { ...(await f.dump()).settings.find(row => row.userId === f.users[0] && row.publicId), profileVisible: false }
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put(hidden))
  assert.equal(await f.profileRepo.loadOwnProfilePin(f.users[0]), own.publicationId, 'owner pin management is independent of profile visibility')
  await f.repo.deletePublication(f.users[0], own.publicationId)
  assert.equal(await f.profileRepo.loadOwnProfilePin(f.users[0]), null)
  assert.equal((await f.dump()).settings.find(row => row.publicId === hidden.publicId).pinnedPublicationId, null)
})

test('unavailable joinedAt/stats do not derive from oldest text, today or publications', async t => {
  const f = await fixture(t)
  await f.runTransaction(['settings'], 'readwrite', tx => { const profile = { ...f.profiles[0] }; delete profile.createdAt; tx.objectStore('settings').put(profile) })
  assert.equal((await f.profileRepo.loadPublicProfile(f.publicProfiles[0].publicId)).stats.joinedAt, null)
  f.stats.delete(f.publicProfiles[2].publicId)
  const foreign = await f.profileRepo.loadPublicProfile(f.publicProfiles[2].publicId)
  assert.equal(foreign.stats, null)
  assert.equal(foreign.publications.length, 1)
})

test('revocation during stats provider lookup returns no profile or statistics', async t => {
  const f = await fixture(t), id = f.publicProfiles[2].publicId
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const repo = createPublicProfileRepository({ runTransaction: f.runTransaction, authorStatsProvider: async publicId => { assert.equal(publicId, id); entered(); await gate; return f.stats.get(id) } })
  const pending = repo.loadPublicProfile(id)
  await started; await f.change(2, { profileVisible: false }); release()
  assert.equal(await pending, null)
  assert.equal(await repo.loadPublicAuthorStats(id), null)
})

test('missing profileVisible remains absent after readonly checks and existing identity loads', async t => {
  const f = await fixture(t), row = { ...f.publicProfiles[0] }; delete row.profileVisible
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put(row))
  const before = await f.dump()
  assert.equal((await f.identityRepo.loadPublicIdentity(f.users[0])).profileVisible, false)
  assert.equal(await f.profileRepo.loadPublicProfile(row.publicId), null)
  assert.deepEqual(await f.dump(), before)
})

test('Profile publications order newest first with stable ID tie-break; Feed/Internet and source stores do not participate', async t => {
  const f = await fixture(t), before = await f.dump()
  const fragments = f.records.filter(record => record.userId === f.users[0] && record.channel === 'feed' && record.snapshot.title === undefined)
  for (const record of fragments) await f.repo.createPublications(f.users[0], { source: record.source, channels: ['profile'] })
  const expected = await f.repo.listOwnPublications(f.users[0], 'profile')
  const profile = await f.profileRepo.loadPublicProfile(f.publicProfiles[0].publicId)
  assert.deepEqual(profile.publications.map(row => row.publicationId), expected.map(row => row.publicationId))
  assert.equal(profile.publications.length, 3)
  assert.ok(profile.publications[0].publishedAt >= profile.publications[1].publishedAt)
  assert.ok(profile.publications[1].publishedAt > profile.publications[2].publishedAt)
  assert.equal(profile.publications[0].snapshot.title, undefined)
  assert.equal(profile.publications[2].snapshot.title, 'Snapshot title')
  const after = await f.dump()
  for (const store of stores.filter(name => name !== 'publications')) assert.deepEqual(after[store], before[store])
  assert.deepEqual(after.publications.filter(row => row.channel !== 'profile'), before.publications.filter(row => row.channel !== 'profile'))
})
