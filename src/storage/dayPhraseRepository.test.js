import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { createServer } from 'vite'
import { connectDatabase } from './database.js'
import { calculateUserDay } from '../domain/writingDay.js'
import { captureBackup, validateBackup, restoreToNewDatabase, verifyRestoredDatabase } from '../backup/backup.js'
import { assertCompatibleBackup } from '../backup/userBackup.js'

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const { createDayPhraseRepository, dayPhrases, dayPhraseKey } = await server.ssrLoadModule('/src/storage/dayPhraseRepository.js')
after(() => server.close())

async function fixture(t) {
  const factory = new IDBFactory()
  let db = await connectDatabase({ factory })
  t.after(() => db.close())
  let writes = 0
  const runTransaction = (stores, mode, run) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let result, failure
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(failure || tx.error)
    tx.onerror = () => {}
    try {
      if (mode === 'readwrite') {
        const store = tx.objectStore('settings'), put = store.put.bind(store)
        store.put = value => { writes++; return put(value) }
      }
      run(tx, value => { result = value }, error => { failure = error; tx.abort() })
    } catch (error) { failure = error; tx.abort() }
  })
  const profile = { key: 'localProfile', userId: 'phrase-owner', displayName: 'Owner', timeZone: 'Europe/Moscow', dayStartMinutes: 240, dayPolicyVersion: 1, createdAt: 1 }
  await runTransaction(['settings'], 'readwrite', tx => {
    tx.objectStore('settings').put(profile)
    tx.objectStore('settings').put({ key: 'unrelated', preserved: true })
  })
  const read = () => runTransaction(['settings'], 'readonly', (tx, done) => {
    const r = tx.objectStore('settings').get(dayPhraseKey(profile.userId)); r.onsuccess = () => done(r.result)
  })
  return { profile, factory, runTransaction, read, writes: () => writes,
    repo: createDayPhraseRepository({ runTransaction, random: () => 0.5 }),
    async reopen() { db.close(); db = await connectDatabase({ factory }) } }
}

test('same-day reload/reopen/concurrent callers retain one phrase and do not rewrite settings', async t => {
  const f = await fixture(t), now = Date.parse('2026-10-07T10:00:00Z')
  const results = await Promise.all(Array.from({ length: 8 }, () => f.repo.loadDayPhrase(f.profile, now)))
  assert.equal(new Set(results).size, 1)
  assert.ok(dayPhrases.includes(results[0]), 'repository uses the actual Markdown import')
  const before = await f.read(), writes = f.writes()
  await f.reopen()
  const reopened = createDayPhraseRepository({ runTransaction: f.runTransaction, random: () => { throw new Error('reload must not shuffle') } })
  assert.equal(await reopened.loadDayPhrase(f.profile, now + 3600000), results[0])
  assert.deepEqual(await f.read(), before)
  assert.equal(f.writes(), writes)
  assert.equal(before.remaining.length, dayPhrases.length - 1)
})

test('day rotation uses JW timezone/start boundary, not midnight or the archived/grace document key', async t => {
  const f = await fixture(t), boundary = Date.parse('2026-10-08T01:00:00Z') // 04:00 Moscow
  const first = await f.repo.loadDayPhrase(f.profile, boundary - 1)
  assert.equal((await f.read()).dayKey, calculateUserDay({ ...f.profile, now: boundary - 1 }).dayKey)
  assert.equal((await f.read()).dayKey, '2026-10-07')
  const next = await f.repo.loadDayPhrase(f.profile, boundary)
  assert.notEqual(next, first)
  assert.equal((await f.read()).dayKey, '2026-10-08')
  assert.equal((await f.read()).remaining.length, dayPhrases.length - 2)
  assert.equal(await f.repo.loadDayPhrase(f.profile, boundary + 1), next)
  assert.equal(await f.repo.loadDayPhrase(f.profile, boundary - 1), next, 'stale concurrent request cannot revert the day')
})

test('future auth contract consumes the next phrase without resetting the queue and rejects absent event/foreign owner', async t => {
  const f = await fixture(t), now = Date.parse('2026-10-07T10:00:00Z')
  await f.repo.loadDayPhrase(f.profile, now)
  const first = await f.read()
  const afterAuth = await f.repo.chooseAfterAuthentication(f.profile, 'confirmed-login-event', now)
  assert.equal(afterAuth, dayPhrases[first.remaining[0]])
  assert.equal((await f.read()).remaining.length, dayPhrases.length - 2)
  assert.equal(await f.repo.chooseAfterAuthentication(f.profile, 'confirmed-login-event', now), afterAuth)
  assert.equal(await f.repo.loadDayPhrase(f.profile, now), afterAuth)
  const before = await f.read()
  await assert.rejects(f.repo.chooseAfterAuthentication(f.profile, '', now), /real auth event/)
  await assert.rejects(f.repo.loadDayPhrase({ ...f.profile, userId: 'foreign' }, now), /owner changed/)
  assert.deepEqual(await f.read(), before)
})

test('existing backup v3 preserves the queue through restore/reopen/compare with no schema change', async t => {
  const f = await fixture(t)
  await f.repo.loadDayPhrase(f.profile, Date.parse('2026-10-07T10:00:00Z'))
  const queue = await f.read()
  const file = await captureBackup({ factory: f.factory, origin: 'https://test.invalid', flush: async () => {} })
  const data = await validateBackup(file)
  assert.equal(data.databaseVersion, 6)
  assert.equal(JSON.parse(await file.text()).formatVersion, 3)
  assertCompatibleBackup(data)
  const settings = data.stores.find(store => store.name === 'settings').records.map(row => row.value)
  assert.deepEqual(settings.find(row => row.key === dayPhraseKey(f.profile.userId)), queue)
  assert.deepEqual(settings.find(row => row.key === 'localProfile'), f.profile)
  assert.deepEqual(settings.find(row => row.key === 'unrelated'), { key: 'unrelated', preserved: true })
  assert.ok(data.stores.filter(store => store.name !== 'settings').every(store => store.count === 0))
  const name = await restoreToNewDatabase(file, { factory: f.factory })
  const result = await verifyRestoredDatabase(file, name, { factory: f.factory })
  assert.equal(result.verified, true)
  assert.equal(result.deleted, true)
})
