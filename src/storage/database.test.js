import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectDatabase } from './database.js'

const now = Date.parse('2026-09-28T10:00:00Z')
const fixture = (key, content = 'Текст\n#осень') => ({
  textId: `text-${key}`, userId: 'local:test', dayKey: key,
  timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1,
  dayStartsAt: Date.parse(`${key}T00:00:00Z`), dayEndsAt: Date.parse(`${key}T00:00:00Z`) + 86400000,
  content, revision: 9, serverRevision: null, createdAt: 123, updatedAt: 456,
})
function seed(name, records) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      const settings = db.createObjectStore('settings', { keyPath: 'key' })
      settings.put({ key: 'localProfile', userId: 'local:test' })
      const store = db.createObjectStore('texts', { keyPath: 'textId' })
      store.createIndex('userDay', ['userId', 'dayKey'], { unique: true })
      store.createIndex('userId', 'userId')
      records.forEach((record) => store.add(record))
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { request.result.close(); resolve() }
  })
}
function all(db, store) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

test('fresh database creates empty userDays and texts', async () => {
  const db = await connectDatabase({ name: crypto.randomUUID(), now })
  assert.equal(db.version, 5)
  assert.deepEqual(await all(db, 'wordCountSamples'), [])
  assert.deepEqual(await all(db, 'texts'), [])
  assert.deepEqual(await all(db, 'userDays'), [])
  db.close()
})

test('migration preserves every text field, links periods, marks past closed and current open', async () => {
  const name = crypto.randomUUID()
  const originals = [fixture('2026-09-27', ''), fixture('2026-09-28')]
  await seed(name, originals)
  let db = await connectDatabase({ name, now })
  const texts = await all(db, 'texts')
  const days = await all(db, 'userDays')
  assert.equal(days.length, 2)
  for (const text of texts) {
    const { userDayId, ...unchanged } = text
    assert.deepEqual(unchanged, originals.find((r) => r.textId === text.textId))
    const period = days.find((d) => d.userDayId === userDayId)
    assert.equal(period.startsAt, text.dayStartsAt)
    assert.equal(period.endsAt, text.dayEndsAt)
    assert.equal(period.state, text.dayKey === '2026-09-27' ? 'closed' : 'open')
    assert.equal(period.closedAt, period.state === 'closed' ? period.endsAt : null)
    assert.equal(period.graceUntil, null)
  }
  assert.deepEqual(await all(db, 'settings'), [{ key: 'localProfile', userId: 'local:test' }])
  db.close()
  db = await connectDatabase({ name, now: now + 86400000 })
  assert.deepEqual(await all(db, 'texts'), texts)
  assert.deepEqual(await all(db, 'userDays'), days) // no hidden lifecycle on reopen
  db.close()
})

test('invalid boundaries abort entire upgrade and preserve version 1 and all originals', async () => {
  for (const invalid of [undefined, 0]) {
    const name = crypto.randomUUID()
    const originals = [fixture('2026-09-26'), { ...fixture('2026-09-27'), dayEndsAt: invalid }]
    await seed(name, originals)
    await assert.rejects(connectDatabase({ name, now }), /Миграция отменена/)
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    assert.equal(db.version, 1)
    assert.equal(db.objectStoreNames.contains('userDays'), false)
    assert.deepEqual(await all(db, 'texts'), originals)
    db.close()
  }
})

test('v2 migration adds day goal fields, preserves first achievement and does not infer past goals', async () => {
  const name = crypto.randomUUID()
  const rows = [
    { userDayId: 'old', userId: 'local:test', dayKey: '2026-09-27', startsAt: now - 86400000, endsAt: now - 1, state: 'closed', revision: 4, goalReached: true, goalReachedAt: now - 1000, goalAtReach: 25 },
    { userDayId: 'current', userId: 'local:test', dayKey: '2026-09-28', startsAt: now - 1, endsAt: now + 1000, state: 'open', revision: 4 },
  ]
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('settings', { keyPath: 'key' }).put({ key: 'localProfile', userId: 'local:test', dailyWordGoal: 510 })
      db.createObjectStore('texts', { keyPath: 'textId' })
      const days = db.createObjectStore('userDays', { keyPath: 'userDayId' })
      rows.forEach((day) => days.add(day))
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { request.result.close(); resolve() }
  })
  let db = await connectDatabase({ name, now })
  const migrated = await all(db, 'userDays')
  const old = migrated.find((d) => d.userDayId === 'old')
  assert.deepEqual(old, { ...rows[0], dailyWordGoal: null, revision: 5 })
  assert.deepEqual(migrated.find((d) => d.userDayId === 'current'), {
    ...rows[1], dailyWordGoal: 510, goalReached: false, goalReachedAt: null, goalAtReach: null, revision: 5,
  })
  db.close()
  db = await connectDatabase({ name, now: now + 100 })
  assert.deepEqual(await all(db, 'userDays'), migrated)
  db.close()
})

test('v3 to v5 creates empty sample history and leaves existing data intact on migration and reload', async () => {
  const name = crypto.randomUUID()
  const originals = {
    settings: { key: 'localProfile', userId: 'user', dailyWordGoal: 510 },
    texts: { textId: 'text', userDayId: 'day', content: 'Старый текст', revision: 9 },
    userDays: { userDayId: 'day', state: 'closed', dayKey: '2026-09-29', revision: 5 },
  }
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 3)
    request.onupgradeneeded = () => {
      for (const [store, keyPath] of [['settings', 'key'], ['texts', 'textId'], ['userDays', 'userDayId']]) {
        request.result.createObjectStore(store, { keyPath }).put(originals[store])
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { request.result.close(); resolve() }
  })
  for (let repeat = 0; repeat < 2; repeat++) {
    const db = await connectDatabase({ name, now })
    assert.equal(db.version, 5)
    assert.deepEqual(await all(db, 'wordCountSamples'), [])
    for (const store of Object.keys(originals)) assert.deepEqual(await all(db, store), [originals[store]])
    db.close()
  }
})
