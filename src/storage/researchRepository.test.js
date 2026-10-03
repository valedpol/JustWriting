import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transaction } from './database.js'
import { loadResearch } from './researchRepository.js'
import { researchData } from '../domain/research.js'

test('research reads only user data; viewing empty date creates nothing and preserves all stores', async () => {
  const stores = ['settings', 'texts', 'userDays', 'wordCountSamples']
  await transaction(stores, 'readwrite', (tx) => {
    tx.objectStore('settings').put({ key: 'localProfile', userId: 'u', timeZone: 'UTC', dayStartMinutes: 0 })
    for (const userId of ['u', 'other']) {
      tx.objectStore('userDays').put({ userDayId: userId, userId, dayKey: '2026-09-29', state: 'closed' })
      tx.objectStore('texts').put({ textId: userId, userDayId: userId, userId, dayKey: '2026-09-29', content: '' })
      tx.objectStore('wordCountSamples').put({ sampleId: userId, userDayId: userId, userId, timestamp: 1, wordCount: 0 })
    }
  })
  const dump = () => transaction(stores, 'readonly', (tx, done) => {
    const data = {}; let pending = stores.length
    for (const name of stores) {
      const read = tx.objectStore(name).getAll()
      read.onsuccess = () => { data[name] = read.result; if (!--pending) done(data) }
    }
  })
  const before = await dump()
  const snapshot = await loadResearch('u')
  assert.equal(snapshot.texts.length, 1)
  assert.equal(snapshot.days.length, 1)
  assert.equal(snapshot.samples.length, 1)
  const view = researchData(snapshot, Date.parse('2026-09-30T12:00:00Z'))
  assert.equal(view.entries.has('2026-09-28'), false)
  assert.deepEqual(await dump(), before)
})
