import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { createMaintenanceCoordinator } from '../runtime/maintenance.js'
import { memoryLocks, memoryStorage } from '../runtime/maintenanceTestHelpers.js'
import { createUserBackupService, assertBackupWriterReady } from './userBackup.js'
import { captureBackup, validateBackup } from './backup.js'
import { encode } from './backupCodec.js'
import { bytesHash } from '../utils/files.js'
import { createSchemaStore, databaseSchema } from '../storage/databaseSchema.js'

async function fixture(flush = async () => {}, version = 4) {
  const factory = new IDBFactory(), sourceName = 'just-writing-backup-test-' + crypto.randomUUID(), opens = []
  const db = await new Promise(resolve => {
    const r = factory.open(sourceName, version)
    r.onupgradeneeded = () => {
      const settings = r.result.createObjectStore('settings', { keyPath: 'key' })
      const texts = r.result.createObjectStore('texts', { keyPath: 'textId' })
      const days = r.result.createObjectStore('userDays', { keyPath: 'userDayId' })
      const samples = r.result.createObjectStore('wordCountSamples', { keyPath: 'sampleId' })
      if (version === 5) createSchemaStore(r.result, 'publications', databaseSchema(5).stores.publications)
      for (const s of [texts, days]) {
        s.createIndex('userDay', ['userId', 'dayKey'], { unique: true }); s.createIndex('userId', 'userId')
      }
      texts.createIndex('userDayId', 'userDayId', { unique: true })
      samples.createIndex('userDayTime', ['userDayId', 'timestamp'], { unique: true })
      settings.add({ key: 'localProfile', userId: 'u', timeZone: 'Europe/Moscow', dayStartMinutes: 0, dayPolicyVersion: 10 })
      days.add({ userDayId: 'day', userId: 'u', dayKey: '2026-09-26', startsAt: 1, endsAt: 2, dayPolicyVersion: 10 })
      days.add({ userDayId: 'empty', userId: 'other', dayKey: '2026-09-27', startsAt: 2, endsAt: 3, unknown: null })
      texts.add({ textId: 'text', userId: 'u', userDayId: 'day', dayKey: '2026-09-26', content: 'Полный текст', revision: 7,
        contentFormat: 'tiptap-json', contentVersion: 1,
        document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Полный текст', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }] }] }] },
        semanticMarkup: ['tag', 'title'].map((kind, i) => ({ id: String(i), kind, valueId: kind, value: kind === 'tag' ? 'JW' : 'Название', source: 'selection', direction: kind === 'title' ? 'forward' : 'backward', anchor: 1, range: { from: 1, to: 6 } })),
        unknown: { nullable: null, optional: undefined, date: new Date(0), bigint: 42n },
      })
      samples.add({ sampleId: 'sample', userId: 'u', userDayId: 'day', dayKey: '2026-09-26', timestamp: 100, wordCount: 2, textRevision: 7 })
    }
    r.onsuccess = () => resolve(r.result)
  })
  db.close()
  const adapter = {
    databases: async () => (await factory.databases()).map(d => d.name === sourceName ? { ...d, name: 'just-writing' } : d),
    open(name, version) { const target = name === 'just-writing' ? sourceName : name; opens.push(target); return factory.open(target, version) },
    deleteDatabase(name) { assert.match(name, /^just-writing-backup-verification-/); return factory.deleteDatabase(name) },
  }
  const locks = memoryLocks(), storage = memoryStorage()
  const coordinator = createMaintenanceCoordinator({ locks, storage })
  await coordinator.registerApplication(); coordinator.registerFlush(flush)
  const service = createUserBackupService({ coordinator, factory: adapter, origin: 'https://backup.test' })
  return { service, factory: adapter, coordinator, opens, locks, storage, sourceName }
}

test('fresh disk checkpoint restores rich text, all marks, tag/title ranges, extra fields, empty days and samples; source unchanged', async () => {
  let flushes = 0
  const f = await fixture(async () => { flushes++ })
  const captured = await f.service.create()
  assert.ok(flushes >= 2)
  const before = await validateBackup(captured.file)
  const file = new File([await captured.file.arrayBuffer()], 'downloaded.json')
  const result = await f.service.verify(file, captured.receipt)
  assert.equal(result.restoreVerified, true); assert.equal(result.isolatedRestoreDeleted, true)
  assert.deepEqual(result.counts, { settings: 1, texts: 1, userDays: 2, wordCountSamples: 1 })
  assert.equal(f.coordinator.status().localPhase, 'normal')
  const after = await validateBackup(await captureBackup({ factory: f.factory, origin: 'https://backup.test', flush: async () => {} }))
  assert.deepEqual(after.stores, before.stores)
  assert.ok(f.opens.every(name => name !== 'just-writing'))
})

test('existing file verification never opens or compares current source, even when its data changed', async () => {
  const f = await fixture()
  const captured = await f.service.create(); await f.service.resume()
  const file = new File([captured.file], 'old.json')
  const source = await new Promise(resolve => { const r = f.factory.open('just-writing'); r.onsuccess = () => resolve(r.result) })
  await new Promise(resolve => { const tx = source.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: 'new', value: 'later edit' }); tx.oncomplete = resolve })
  source.close(); f.opens.length = 0
  const result = await f.service.verify(file)
  assert.equal(result.restoreVerified, true)
  assert.equal(result.counts.settings, 1)
  assert.ok(f.opens.length >= 2 && f.opens.every(name => name.startsWith('just-writing-backup-verification-')))
})

async function reseal(file, change) {
  const data = await validateBackup(file); change(data)
  const payload = await encode(data)
  const hash = value => bytesHash(new TextEncoder().encode(JSON.stringify(value)))
  const storeHashes = await Promise.all(data.stores.map(async s => ({ name: s.name, sha256: await hash(await encode(s)) })))
  return new File([JSON.stringify({ format: 'just-writing-backup', formatVersion: 1, payload, storeHashes, sha256: await hash({ payload, storeHashes }) })], 'incompatible.json')
}

test('corrupt, wrong version/schema, broken links and unsupported rich data stop before any restore open', async () => {
  const f = await fixture(); const captured = await f.service.create(); await f.service.resume()
  for (const file of [new File(['broken'], 'bad.json'),
    new File([JSON.stringify({ ...JSON.parse(await captured.file.text()), sha256: 'tampered' })], 'tampered.json'),
    new File([JSON.stringify({ ...JSON.parse(await captured.file.text()), formatVersion: 2 })], 'wrong-format.json'),
    await reseal(captured.file, d => { d.databaseVersion = 5 }),
    await reseal(captured.file, d => { d.stores[1].indexes = [] }),
    await reseal(captured.file, d => { d.stores[1].records[0].value.userDayId = 'missing' }),
    await reseal(captured.file, d => { d.stores[1].records[0].value.contentVersion = 99 }),
  ]) {
    f.opens.length = 0; await assert.rejects(f.service.verify(file)); assert.deepEqual(f.opens, [])
  }
})

test('failed isolated add aborts all stores and leaves source data intact', async () => {
  const f = await fixture(); const captured = await f.service.create(); await f.service.resume()
  const incompatible = await reseal(captured.file, data => {
    const texts = data.stores.find(s => s.name === 'texts')
    const duplicate = structuredClone(texts.records[0])
    duplicate.key = 'another-text'; duplicate.value.textId = duplicate.key
    texts.records.push(duplicate); texts.count++ // conflicting unique userDay index
  })
  f.opens.length = 0
  await assert.rejects(f.service.verify(incompatible))
  assert.ok(f.opens.every(name => name.startsWith('just-writing-backup-verification-')))
  const name = f.opens[0]
  const restored = await new Promise(resolve => { const r = f.factory.open(name); r.onsuccess = () => resolve(r.result) })
  await new Promise((resolve, reject) => {
    const tx = restored.transaction([...restored.objectStoreNames], 'readonly')
    for (const store of restored.objectStoreNames) tx.objectStore(store).count().onsuccess = e => assert.equal(e.target.result, 0)
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error)
  })
  restored.close()
  const after = await validateBackup(await captureBackup({ factory: f.factory, origin: 'https://backup.test', flush: async () => {} }))
  assert.deepEqual(after.stores, (await validateBackup(captured.file)).stores)
})

test('disk file must match newly captured bytes; failed flush stays blocked until explicit exit', async () => {
  const f = await fixture(); const captured = await f.service.create()
  await assert.rejects(f.service.verify(await reseal(captured.file, d => { d.capturedAt++ }), captured.receipt), /differs/)
  assert.equal(f.coordinator.status().active, true); await f.service.resume()
  const broken = await fixture(async () => { throw new Error('unsaved') })
  await assert.rejects(broken.service.create(), /unsaved/)
  assert.equal(broken.coordinator.status().localPhase, 'failed'); assert.deepEqual(broken.opens, [])
  await broken.service.resume()
})

test('IME, save pending/error and second tab block creation without a snapshot', async () => {
  const f = await fixture()
  for (const controller of [null, { composing: true, snapshot: { status: 'saved' } }, { snapshot: { status: 'saving' } }, { snapshot: { status: 'error' } }]) {
    await assert.rejects(f.service.create(() => assertBackupWriterReady(controller, 'saved')))
  }
  assert.deepEqual(f.opens, [])
  const other = createMaintenanceCoordinator({ locks: f.locks, storage: f.storage })
  await other.registerApplication()
  await assert.rejects(f.service.create(), /close other application tabs/)
  assert.deepEqual(f.opens, [])
  await f.service.resume(); await other.exit()
})

test('v5 maintenance checkpoint and exact disk-file verification include publications and format version without modifying source', async () => {
  const f = await fixture(async () => {}, 5)
  const captured = await f.service.create()
  assert.equal(captured.receipt.dbVersion, 5)
  assert.equal(captured.receipt.formatVersion, 2)
  assert.equal(captured.receipt.counts.publications, 0)
  const before = await validateBackup(captured.file)
  const file = new File([await captured.file.arrayBuffer()], 'v5-checkpoint.json')
  const result = await f.service.verify(file, captured.receipt)
  assert.equal(result.restoreVerified, true)
  assert.equal(result.isolatedRestoreDeleted, true)
  assert.equal(result.formatVersion, 2)
  assert.equal(f.coordinator.status().localPhase, 'normal')
  const after = await validateBackup(await captureBackup({ factory: f.factory, origin: 'https://backup.test', flush: async () => {} }))
  assert.deepEqual(after.stores, before.stores)
})
