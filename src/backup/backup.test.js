import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { encode, decode } from './backupCodec.js'
import { captureBackup, validateBackup, restoreToNewDatabase, verifyRestoredDatabase } from './backup.js'

async function fixture() {
  const factory = new IDBFactory()
  const db = await new Promise((resolve, reject) => {
    const r = factory.open('just-writing', 4)
    r.onupgradeneeded = () => {
      for (const [name, keyPath] of [['settings', 'key'], ['texts', 'textId'], ['userDays', 'userDayId'], ['wordCountSamples', 'sampleId']]) {
        const s = r.result.createObjectStore(name, { keyPath })
        s.createIndex('user', 'userId')
      }
    }
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error)
  })
  await new Promise((resolve, reject) => {
    const tx = db.transaction(Array.from(db.objectStoreNames), 'readwrite')
    tx.objectStore('settings').add({ key: 'futureSetting', userId: 'u', value: null })
    tx.objectStore('userDays').add({ userDayId: 'd', userId: 'u', dayKey: '2027-03-10', startsAt: Date.parse('2027-03-09T21:00Z'), endsAt: Date.parse('2027-03-10T21:00Z'), timeZone: 'Europe/Moscow', dayStartMinutes: 0, dayPolicyVersion: 1 })
    const unknown = { absent: undefined, nullable: null, date: new Date(0), bigint: 1n, bytes: new Uint16Array([1, 65535]), map: new Map([['x', new Set([NaN, Infinity])]]), blob: new Blob(['hello']) }; unknown.self = unknown
    tx.objectStore('texts').add({ textId: 'other', userId: 'other-user', unknown })
    tx.objectStore('wordCountSamples').add({ sampleId: 's', timestamp: 123 })
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error)
  })
  db.close(); return factory
}

test('lossless graph preserves missing/null, sparse arrays, cycles and shared buffers', async () => {
  const buffer = new ArrayBuffer(8), value = { a: undefined, b: null, minusZero: -0, sparse: new Array(3), buffer, view: new Uint8Array(buffer) }; value.self = value
  const result = decode(await encode(value))
  assert.deepEqual(result, value)
  assert.equal(result.view.buffer, result.buffer)
  assert.equal(Object.hasOwn(result, 'missing'), false)
  assert.equal(Object.hasOwn(result, 'a'), true)
  await assert.rejects(encode(new Error('unsupported')), /Unsupported/)
})

test('flush, file reread, all users/stores, isolated restore/reopen/full verification and cleanup', async () => {
  const factory = await fixture(); let flushed = false
  const file = await captureBackup({ factory, origin: 'https://example.test', flush: async () => { flushed = true } })
  assert.equal(flushed, true)
  const data = await validateBackup(file)
  assert.equal(data.stores[1].records[0].value.userId, 'other-user')
  const name = await restoreToNewDatabase(file, { factory })
  const result = await verifyRestoredDatabase(file, name, { factory })
  assert.equal(result.verified, true)
  assert.equal(result.deleted, true)
  assert.deepEqual(result.counts, { settings: 1, texts: 1, userDays: 1, wordCountSamples: 1 })
  assert.deepEqual((await factory.databases()).map(d => d.name), ['just-writing'])
  const after = await captureBackup({ factory, origin: 'https://example.test', flush: async () => {} })
  assert.deepEqual((await validateBackup(after)).stores, data.stores)
  await assert.rejects(verifyRestoredDatabase(file, 'just-writing', { factory }), /Only/)
})

test('tampering and failed flush stop backup; verification detects changed values', async () => {
  const factory = await fixture()
  await assert.rejects(captureBackup({ factory, origin: 'x', flush: async () => { throw new Error('unsaved') } }), /unsaved/)
  const file = await captureBackup({ factory, origin: 'x', flush: async () => {} })
  const altered = JSON.parse(await file.text()); altered.payload.nodes[0][2].push(['tampered', ['primitive', true]])
  await assert.rejects(validateBackup(new Blob([JSON.stringify(altered)])), /integrity/)
  const name = await restoreToNewDatabase(file, { factory })
  const db = await new Promise(resolve => { const r = factory.open(name); r.onsuccess = () => resolve(r.result) })
  await new Promise(resolve => { const tx = db.transaction('texts', 'readwrite'); tx.objectStore('texts').put({ textId: 'other', unknown: null }); tx.oncomplete = resolve })
  db.close()
  await assert.rejects(verifyRestoredDatabase(file, name, { factory }), /differ/)
})
