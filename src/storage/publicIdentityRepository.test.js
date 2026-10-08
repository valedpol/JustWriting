import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { connectDatabase } from './database.js'
import { initializePublicIdentity } from '../domain/publicIdentity.js'
import { createPublicIdentityRepository } from './publicIdentityRepository.js'

async function fixture(t) {
  const factory = new IDBFactory(), name = `identity-test-${crypto.randomUUID()}`
  let db = await connectDatabase({ factory, name })
  t.after(() => db.close())
  const runTransaction = (stores, mode, run) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let result, failure
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(failure || tx.error)
    tx.onerror = () => {}
    try { run(tx, value => { result = value }, error => { failure = error; tx.abort() }) }
    catch (error) { failure = error; tx.abort() }
  })
  const users = ['fixture-a', 'fixture-b', 'fixture-c']
  const records = users.map(userId => ({ ...initializePublicIdentity(userId), key: `publicProfile:${userId}`, unknown: { preserved: true } }))
  await runTransaction(['settings'], 'readwrite', tx => records.forEach(record => tx.objectStore('settings').put(record)))
  const owner = userId => runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ key: 'localProfile', userId, displayName: 'Private name' }))
  const dump = () => runTransaction(['settings'], 'readonly', (tx, done) => {
    const read = tx.objectStore('settings').getAll(); read.onsuccess = () => done(read.result)
  })
  return { users, records, runTransaction, owner, dump, repo: createPublicIdentityRepository({ runTransaction }),
    reopen: async () => { db.close(); db = await connectDatabase({ factory, name }) } }
}

test('three identities reject case/Unicode collisions atomically, preserve display and retain publicId through rename/clear/reopen', async t => {
  const f = await fixture(t), [a, b, c] = f.users
  await f.owner(a)
  await f.repo.savePublicNickname(a, '  Éva  ')
  const first = await f.repo.loadPublicIdentity(a)
  assert.equal(first.nickname, 'Éva')
  await f.owner(b)
  const before = await f.dump()
  await assert.rejects(f.repo.savePublicNickname(b, ' e\u0301VA '), { message: 'Этот никнейм уже занят.' })
  assert.deepEqual(await f.dump(), before, 'collision must abort the entire save')
  await f.repo.savePublicNickname(b, 'Mumipol')
  await f.owner(c)
  await assert.rejects(f.repo.savePublicNickname(c, 'mumipol'), /Этот никнейм уже занят/)
  await f.repo.savePublicNickname(c, 'Third')
  await f.owner(a)
  await f.repo.savePublicNickname(a, 'éVA') // Own spelling changes are permitted.
  assert.equal((await f.repo.loadPublicIdentity(a)).nickname, 'éVA')
  await f.repo.savePublicNickname(a, '')
  await f.reopen()
  assert.deepEqual(await f.repo.loadPublicIdentity(a), { ...first, nickname: '', displayName: first.alias, displayLabel: first.alias })
  await f.owner(b)
  await f.repo.savePublicNickname(b, 'E\u0301va') // Clearing released the old key.
  assert.equal((await f.repo.loadPublicIdentity(b)).nickname, 'E\u0301va', 'display remains decomposed as supplied')
  const stored = (await f.dump()).find(record => record.userId === a)
  assert.deepEqual(stored.unknown, { preserved: true })
  assert.equal(stored.publicId, first.publicId)
})

test('concurrent multi-user nickname claims serialize directory check and reservation', async t => {
  const f = await fixture(t), [a, b] = f.users
  const results = await Promise.allSettled([
    f.owner(a), f.repo.savePublicNickname(a, 'Claim'),
    f.owner(b), f.repo.savePublicNickname(b, 'CLAIM'),
  ])
  assert.equal(results[1].status, 'fulfilled')
  assert.equal(results[3].status, 'rejected')
  assert.equal(results[3].reason.message, 'Этот никнейм уже занят.')
  assert.equal((await f.repo.loadPublicIdentity(a)).nickname, 'Claim')
  assert.equal((await f.repo.loadPublicIdentity(b)).nickname, '')
})

test('legacy public identity without publicId reserves its nickname; unrelated settings do not', async t => {
  const f = await fixture(t), [a, b] = f.users
  await f.runTransaction(['settings'], 'readwrite', tx => {
    tx.objectStore('settings').put({ key: `publicProfile:${a}`, userId: a, publicNickname: 'Legacy' })
    tx.objectStore('settings').put({ key: 'unrelated', publicNickname: 'Available' })
  })
  await f.owner(b)
  await assert.rejects(f.repo.savePublicNickname(b, 'LEGACY'), /Этот никнейм уже занят/)
  await f.repo.savePublicNickname(b, 'Available')
  assert.equal((await f.repo.loadPublicIdentity(b)).nickname, 'Available')
})

test('disclosed author name is readonly, live for current user/fixture provider, unavailable without consent or source', async t => {
  const f = await fixture(t), [a, b, c] = f.users
  await f.owner(a)
  await f.runTransaction(['settings'], 'readwrite', tx => {
    for (const record of f.records) tx.objectStore('settings').put({ ...record, allowNameDisclosure: record.userId !== c })
  })
  const names = new Map([[b, 'Fixture current name']]), accesses = []
  const repository = createPublicIdentityRepository({
    runTransaction: (...args) => { accesses.push([args[0], args[1]]); return f.runTransaction(...args) },
    authorProfileProvider: async userId => names.get(userId) ?? null,
  })
  const before = await f.dump()
  assert.equal(await repository.loadDisclosedAuthorName(f.records[0].publicId), 'Private name')
  assert.equal(await repository.loadDisclosedAuthorName(f.records[1].publicId), 'Fixture current name')
  assert.equal(await repository.loadDisclosedAuthorName(f.records[2].publicId), null)
  assert.equal(await repository.loadDisclosedAuthorName('unknown'), null)
  assert.deepEqual(await f.dump(), before)
  assert.ok(accesses.every(([stores, mode]) => mode === 'readonly' && stores.length === 1 && stores[0] === 'settings'))
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ key: 'localProfile', userId: a, displayName: 'Changed internal name' }))
  assert.equal(await repository.loadDisclosedAuthorName(f.records[0].publicId), 'Changed internal name')
  names.delete(b)
  assert.equal(await repository.loadDisclosedAuthorName(f.records[1].publicId), null)
})

test('revocation during async author-profile lookup prevents name disclosure', async t => {
  const f = await fixture(t), [a, b] = f.users
  await f.owner(a)
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ ...f.records[1], allowNameDisclosure: true }))
  let release, entered
  const started = new Promise(resolve => { entered = resolve }), gate = new Promise(resolve => { release = resolve })
  const repo = createPublicIdentityRepository({ runTransaction: f.runTransaction, authorProfileProvider: async userId => {
    assert.equal(userId, b); entered(); await gate; return 'Must not be disclosed'
  } })
  const name = repo.loadDisclosedAuthorName(f.records[1].publicId)
  await started
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ ...f.records[1], allowNameDisclosure: false }))
  release()
  assert.equal(await name, null)
})
