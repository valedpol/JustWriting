import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { databaseSchema, createSchemaStore } from '../storage/databaseSchema.js'
import { connectDatabase } from '../storage/database.js'
import { captureBackup, validateBackup, restoreToNewDatabase, verifyRestoredDatabase, readBackupDatabaseSnapshot } from './backup.js'
import { assertCompatibleBackup, createUserBackupService } from './userBackup.js'
import { encode } from './backupCodec.js'
import { bytesHash } from '../utils/files.js'

const open = (factory, name, version, upgrade) => new Promise((resolve, reject) => {
  const r = factory.open(name, version)
  r.onupgradeneeded = () => upgrade?.(r.result, r.transaction)
  r.onsuccess = () => resolve(r.result)
  r.onerror = () => reject(r.error)
})
const write = (db, stores, run) => new Promise((resolve, reject) => {
  const tx = db.transaction(stores, 'readwrite')
  tx.oncomplete = resolve; tx.onabort = () => reject(tx.error)
  run(tx)
})
async function fixture() {
  const factory = new IDBFactory(), name = 'jw-storage-test-' + crypto.randomUUID(), opens = []
  const db = await open(factory, name, 4, db => {
    for (const [name, definition] of Object.entries(databaseSchema(4).stores)) createSchemaStore(db, name, definition)
  })
  await write(db, Object.keys(databaseSchema(4).stores), tx => {
    tx.objectStore('settings').add({ key: 'localProfile', userId: 'u', createdAt: 123, timeZone: 'Europe/Moscow', dayPolicyVersion: 10 })
    for (const userId of ['u', 'other']) {
      tx.objectStore('userDays').add({ userDayId: userId, userId, dayKey: '2026-09-26', startsAt: 123, endsAt: 456, revision: 7, policyExtra: null })
      tx.objectStore('texts').add({ textId: userId, userId, userDayId: userId, dayKey: '2026-09-26', revision: 9, content: 'Текст\r\nстрока',
        extra: { absent: undefined, nullable: null, bytes: new Uint8Array([0, 255]), date: new Date(123), bigint: 42n } })
      tx.objectStore('wordCountSamples').add({ sampleId: userId, userId, userDayId: userId, dayKey: '2026-09-26', timestamp: 123, wordCount: 2 })
    }
    tx.objectStore('userDays').add({ userDayId: 'empty', userId: 'u', dayKey: '2026-09-27' })
  })
  const before = await readBackupDatabaseSnapshot(db); db.close()
  const adapter = {
    databases: async () => (await factory.databases()).map(d => d.name === name ? { ...d, name: 'just-writing' } : d),
    open(target, version) { const resolved = target === 'just-writing' ? name : target; opens.push(resolved); return factory.open(resolved, version) },
    deleteDatabase(target) { assert.match(target, /^just-writing-backup-verification-/); return factory.deleteDatabase(target) },
  }
  return { factory, name, adapter, before, opens }
}
const snapshot = async (factory, name, version) => {
  const db = await open(factory, name, version)
  try { return await readBackupDatabaseSnapshot(db) } finally { db.close() }
}
const legacyStores = data => data.stores.filter(s => s.name !== 'publications')

async function reseal(file, change) {
  const envelope = JSON.parse(await file.text()), data = await validateBackup(file)
  change(data, envelope)
  envelope.payload = await encode(data)
  const hash = value => bytesHash(new TextEncoder().encode(JSON.stringify(value)))
  envelope.storeHashes = await Promise.all(data.stores.map(async s => ({ name: s.name, sha256: await hash(await encode(s)) })))
  envelope.sha256 = await hash({ payload: envelope.payload, storeHashes: envelope.storeHashes })
  return new File([JSON.stringify(envelope)], 'changed.json')
}

test('v4 to v5 only adds empty publications and its indexes; old schema, keys and lossless values survive reopen', async () => {
  const f = await fixture()
  const db = await connectDatabase({ name: f.name, factory: f.factory })
  assert.equal(db.version, 5)
  const after = await readBackupDatabaseSnapshot(db); db.close()
  assert.deepEqual(legacyStores(after), f.before.stores)
  const added = after.stores.find(s => s.name === 'publications')
  assert.equal(added.count, 0)
  assert.deepEqual(added.records, [])
  assert.deepEqual(added.indexes, [...databaseSchema(5).stores.publications.indexes].sort((a, b) => a.name.localeCompare(b.name)))
  assert.deepEqual(await snapshot(f.factory, f.name, 5), after)
})

test('old v1 backup first restores exactly as v4; a separate migration of that UUID copy preserves all old stores', async () => {
  const f = await fixture()
  const file = await captureBackup({ factory: f.adapter, origin: 'https://test.invalid', flush: async () => {} })
  assert.equal(JSON.parse(await file.text()).formatVersion, 1)
  const data = await validateBackup(file); assertCompatibleBackup(data)
  const name = await restoreToNewDatabase(file, { factory: f.adapter })
  const exact = await verifyRestoredDatabase(file, name, { factory: f.adapter, deleteAfterSuccess: false })
  assert.equal(exact.databaseVersion, 4); assert.equal(exact.verified, true)
  assert.deepEqual(await snapshot(f.factory, name, 4), { databaseVersion: 4, stores: data.stores })
  f.opens.length = 0
  const migrated = await connectDatabase({ name, factory: f.adapter })
  const after = await readBackupDatabaseSnapshot(migrated); migrated.close()
  assert.equal(after.databaseVersion, 5)
  assert.deepEqual(legacyStores(after), data.stores)
  assert.equal(after.stores.find(s => s.name === 'publications').count, 0)
  assert.ok(f.opens.every(opened => opened === name), 'migration only opens the UUID restore copy')
  assert.deepEqual(await snapshot(f.factory, name, 5), after)
  assert.deepEqual(await snapshot(f.factory, f.name, 4), f.before)
})

test('v2 captures five stores and all users losslessly; file verification never opens source and rejects changed publication values after reopen', async () => {
  const f = await fixture()
  const db = await connectDatabase({ name: f.name, factory: f.factory })
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Снимок', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }] }] }] }
  await write(db, ['publications'], tx => {
    for (const [i, userId] of ['u', 'other', 'third'].entries()) tx.objectStore('publications').add({
      publicationId: userId, publicationVersion: 1, userId, channel: 'feed', publishedAt: 100 + i,
      snapshot: { content: 'Снимок', document: doc, contentFormat: 'tiptap-json', contentVersion: 1, title: 'Название' },
      authorVisibility: 'visible', source: { sourceType: 'archive', sourceId: userId, sourceRevision: 1, coordinateVersion: 1, range: { from: 1, to: 7 }, archive: { dayKey: '2026-09-26', userDayId: userId } },
      unknown: { missingValue: undefined, nullable: null, set: new Set(['a']), bytes: new Uint8Array([1, 2]) },
    })
  }); db.close()
  const file = new File([await captureBackup({ factory: f.adapter, origin: 'https://test.invalid', flush: async () => {} })], 'v2.json')
  assert.equal(JSON.parse(await file.text()).formatVersion, 2)
  const data = await validateBackup(file); assertCompatibleBackup(data)
  assert.deepEqual(legacyStores(data), f.before.stores)
  f.opens.length = 0
  const service = createUserBackupService({ factory: f.adapter, origin: 'https://test.invalid' })
  const result = await service.verify(file)
  assert.equal(result.restoreVerified, true); assert.equal(result.isolatedRestoreDeleted, true)
  assert.equal(result.counts.publications, 3)
  assert.equal(result.dbVersion, 5)
  assert.equal(result.formatVersion, 2)
  assert.ok(f.opens.every(opened => opened.startsWith('just-writing-backup-verification-')))
  const name = await restoreToNewDatabase(file, { factory: f.adapter })
  const restored = await open(f.factory, name, 5)
  await write(restored, ['publications'], tx => {
    const read = tx.objectStore('publications').get('u')
    read.onsuccess = () => tx.objectStore('publications').put({ ...read.result, authorVisibility: 'hidden' })
  }); restored.close()
  await assert.rejects(verifyRestoredDatabase(file, name, { factory: f.adapter }), /differ/)
  assert.deepEqual((await snapshot(f.factory, f.name, 5)).stores, data.stores)
})

test('format/schema combinations, missing publications, extra stores and wrong indexes fail before isolated restore', async () => {
  const f = await fixture()
  const db = await connectDatabase({ name: f.name, factory: f.factory }); db.close()
  const file = await captureBackup({ factory: f.adapter, origin: 'https://test.invalid', flush: async () => {} })
  const service = createUserBackupService({ factory: f.adapter })
  for (const change of [
    (data, envelope) => { envelope.formatVersion = 1 },
    data => { data.stores.pop() },
    data => { data.databaseVersion = 6 },
    data => { data.stores.push({ name: 'unknown', records: [], count: 0 }) },
    data => { data.stores.at(-1).indexes[0].unique = true },
  ]) {
    const bad = await reseal(file, change)
    f.opens.length = 0
    await assert.rejects(service.verify(bad))
    assert.deepEqual(f.opens, [])
  }
})

test('aborted v4 upgrade rolls back schema and preserves all four stores and version', async () => {
  const f = await fixture()
  const aborting = { open(name, version) {
    const request = f.factory.open(name, version)
    request.addEventListener('upgradeneeded', () => queueMicrotask(() => request.transaction.abort()))
    return request
  } }
  await assert.rejects(connectDatabase({ name: f.name, factory: aborting }))
  assert.deepEqual(await snapshot(f.factory, f.name, 4), f.before)
})

test('blocked v5 upgrade rejects without upgrading while another v4 connection remains open', async () => {
  const f = await fixture(), held = await open(f.factory, f.name, 4)
  let lateSuccess
  const blocked = { open(name, version) {
    const request = f.factory.open(name, version)
    lateSuccess = new Promise(resolve => request.addEventListener('success', resolve))
    return request
  } }
  await assert.rejects(connectDatabase({ name: f.name, factory: blocked }), /вкладки/)
  assert.equal(held.version, 4)
  assert.deepEqual(await readBackupDatabaseSnapshot(held), f.before)
  held.close(); await lateSuccess // Rejected open closes its eventual connection.
})
