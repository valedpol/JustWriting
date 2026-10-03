import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { memoryLocks, memoryStorage } from './maintenanceTestHelpers.js'

// Each test worker has its own realm. Simulate separate Vite/Console URL module
// instances while using only memory locks and UUID IndexedDB databases.
const locks = memoryLocks(), storage = memoryStorage()
Object.defineProperty(globalThis.navigator, 'locks', { value: locks, configurable: true })
globalThis.localStorage = storage
const first = await import('./maintenance.js?application')
const second = await import('./maintenance.js?console')
const backupA = await import('../backup/backup.js?application')
const backupB = await import('../backup/backup.js?console')
const { createCheckpoint, verifyCheckpointFromDisk } = await import('../backup/checkpoint.js')

async function factoryWithEmptyDatabase() {
  const factory = new IDBFactory(), name = 'just-writing-backup-test-' + crypto.randomUUID(), opened = []
  await new Promise((resolve, reject) => {
    const request = factory.open(name, 4)
    request.onupgradeneeded = () => {
      for (const [store, keyPath] of [['settings', 'key'], ['texts', 'textId'], ['userDays', 'userDayId'], ['wordCountSamples', 'sampleId']]) {
        request.result.createObjectStore(store, { keyPath })
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { request.result.close(); resolve() }
  })
  return { opened, factory: {
    async databases() { return (await factory.databases()).map(d => d.name === name ? { ...d, name: 'just-writing' } : d) },
    open(requested, version) {
      const target = requested === 'just-writing' ? name : requested
      assert.match(target, /^just-writing-backup-(?:test|verification)-[0-9a-f-]{36}$/i)
      opened.push(target); return factory.open(target, version)
    },
    deleteDatabase(target) { assert.match(target, /^just-writing-backup-verification-/); return factory.deleteDatabase(target) },
  } }
}

test('query URL imports share one coordinator, one presence lease, all flushers and isolated verification registry', async () => {
  const a = first.maintenance, b = second.maintenance
  assert.equal(a, b)
  await Promise.all([a.registerApplication(), b.registerApplication()])
  assert.equal((await locks.query()).held.length, 1)
  let firstFlush = 0, secondFlush = 0
  const offA = backupA.registerBackupFlush(async () => { firstFlush++ })
  const offB = backupB.registerBackupFlush(async () => { secondFlush++ })
  const { factory, opened } = await factoryWithEmptyDatabase()
  try {
    const entered = await a.enter()
    assert.equal(b.status().localPhase, 'maintenance')
    assert.equal(b.status().token, entered.token)
    await b.assertReady(entered.token)
    assert.equal(firstFlush, 1); assert.equal(secondFlush, 1)
    const file = await backupB.captureBackup({ factory, origin: 'https://other-origin.test' })
    assert.equal(firstFlush, 2); assert.equal(secondFlush, 2)
    const name = await backupA.restoreToNewDatabase(file, { factory })
    const result = await backupB.verifyRestoredDatabase(file, name, { factory })
    assert.equal(result.verified, true)
    assert.deepEqual(result.counts, { settings: 0, texts: 0, userDays: 0, wordCountSamples: 0 })
    assert.ok(opened.every(n => n !== 'just-writing'))
    await b.exit()
    assert.equal(a.status().localPhase, 'normal')
  } finally { offA(); offB() }
})

test('generic maintenance checkpoint works without profile or any dated day; disk bytes and owner are required', async () => {
  const c = first.maintenance
  const off = c.registerFlush(async () => {})
  const { factory, opened } = await factoryWithEmptyDatabase()
  try {
    await c.enter()
    const captured = await createCheckpoint({ factory, origin: 'https://other-origin.test' })
    const file = new File([await captured.file.arrayBuffer()], 'checkpoint.json')
    const result = await verifyCheckpointFromDisk(file, captured.receipt, { factory })
    assert.equal(result.verifiedFromDisk, true); assert.equal(result.restoreVerified, true)
    assert.equal(result.origin, 'https://other-origin.test')
    assert.equal(Object.hasOwn(result, 'nativeDay'), false)
    assert.deepEqual(result.counts, { settings: 0, texts: 0, userDays: 0, wordCountSamples: 0 })
    await assert.rejects(verifyCheckpointFromDisk(new File(['changed'], 'x.json'), captured.receipt, { factory }), /differs/)
    await assert.rejects(verifyCheckpointFromDisk(file, { ...captured.receipt, origin: 'https://wrong.test' }, { factory }), /origin/)
    await assert.rejects(verifyCheckpointFromDisk(file, { ...captured.receipt, maintenanceToken: 'wrong' }, { factory }), /token/)
    assert.ok(opened.every(n => n !== 'just-writing'))
  } finally { await c.exit(); off() }
})
