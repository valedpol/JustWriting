import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { databaseSchema, createSchemaStore } from '../storage/databaseSchema.js'
import { connectDatabase } from '../storage/database.js'
import { captureBackup, validateBackup, restoreToNewDatabase, verifyRestoredDatabase, readBackupDatabaseSnapshot } from './backup.js'
import { assertCompatibleBackup } from './userBackup.js'

const open = (factory, name, version, upgrade) => new Promise((resolve, reject) => {
  const request = factory.open(name, version)
  request.onupgradeneeded = () => upgrade?.(request.result)
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
})
const write = (db, run) => new Promise((resolve, reject) => {
  const tx = db.transaction([...db.objectStoreNames], 'readwrite')
  tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); run(tx)
})
async function fixture() {
  const factory = new IDBFactory(), db = await open(factory, 'just-writing', 5, db => {
    for (const [name, shape] of Object.entries(databaseSchema(5).stores)) createSchemaStore(db, name, shape)
  })
  const publication = { publicationId: 'p', userId: 'u', channel: 'feed', publishedAt: 10,
    source: { sourceType: 'archive', sourceId: 't', sourceRevision: 1, coordinateVersion: 1,
      range: { from: 1, to: 5 }, archive: { userDayId: 'd', dayKey: '2026-10-07' } },
    snapshot: { content: 'text', document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'text' }] }] } },
    unknown: { missing: undefined, bytes: new Uint8Array([1, 255]), map: new Map([['x', null]]) } }
  await write(db, tx => {
    tx.objectStore('settings').add({ key: 'localProfile', userId: 'u', createdAt: 1 })
    tx.objectStore('texts').add({ textId: 't', userId: 'u', userDayId: 'd', dayKey: '2026-10-07', revision: 3, content: 'new text' })
    tx.objectStore('userDays').add({ userDayId: 'd', userId: 'u', dayKey: '2026-10-07' })
    tx.objectStore('publications').add(publication)
  })
  const before = await readBackupDatabaseSnapshot(db); db.close()
  return { factory, before, publication }
}

test('v5 → v6 changes only the historical index, adds empty anchors, and never guesses anchors for old publications', async () => {
  const f = await fixture(), db = await connectDatabase({ factory: f.factory })
  const after = await readBackupDatabaseSnapshot(db)
  assert.equal(db.version, 6)
  for (const old of f.before.stores) {
    const current = after.stores.find(s => s.name === old.name)
    assert.deepEqual(current.records, old.records)
    if (old.name !== 'publications') assert.deepEqual(current, old)
  }
  assert.equal(after.stores.find(s => s.name === 'publicationAnchors').count, 0)
  assert.equal(db.transaction('publications').objectStore('publications').index('sourceChannelRange').unique, false)
  db.close()
  const reopened = await connectDatabase({ factory: f.factory })
  assert.deepEqual(await readBackupDatabaseSnapshot(reopened), after); reopened.close()
})

test('v2 backup exactly restores v5 and safely migrates the UUID copy to v6; working v5 is untouched', async () => {
  const f = await fixture()
  const file = await captureBackup({ factory: f.factory, origin: 'https://test.invalid', flush: async () => {} })
  assert.equal(JSON.parse(await file.text()).formatVersion, 2)
  const name = await restoreToNewDatabase(file, { factory: f.factory })
  const result = await verifyRestoredDatabase(file, name, { factory: f.factory, deleteAfterSuccess: false })
  assert.equal(result.databaseVersion, 5); assert.equal(result.migratedDatabaseVersion, 6); assert.equal(result.migrationVerified, true)
  const migrated = await open(f.factory, name, 6)
  const data = await readBackupDatabaseSnapshot(migrated); migrated.close()
  assert.deepEqual(data.stores.find(s => s.name === 'publications').records, f.before.stores.find(s => s.name === 'publications').records)
  assert.equal(data.stores.find(s => s.name === 'publicationAnchors').count, 0)
  const source = await open(f.factory, 'just-writing', 5)
  assert.deepEqual(await readBackupDatabaseSnapshot(source), f.before); source.close()
})

test('v3 covers attached/detached anchors in full restore/reopen/compare; invalid anchor relations are incompatible', async () => {
  const f = await fixture(), db = await connectDatabase({ factory: f.factory })
  await write(db, tx => {
    tx.objectStore('publicationAnchors').add({ publicationId: 'p', userId: 'u', sourceType: 'archive', sourceId: 't',
      coordinateVersion: 1, sourceRevision: 3, status: 'attached', range: { from: 5, to: 9 } })
    tx.objectStore('publications').add({ ...f.publication, publicationId: 'p2' })
    tx.objectStore('publicationAnchors').add({ publicationId: 'p2', userId: 'u', sourceType: 'archive', sourceId: 't',
      coordinateVersion: 1, sourceRevision: 3, status: 'detached', range: null, detachedBy: { id: 'session-step', side: 'after' } })
  }); db.close()
  const file = await captureBackup({ factory: f.factory, origin: 'https://test.invalid', flush: async () => {} })
  assert.equal(JSON.parse(await file.text()).formatVersion, 3)
  const data = await validateBackup(file); assertCompatibleBackup(data)
  const name = await restoreToNewDatabase(file, { factory: f.factory })
  const result = await verifyRestoredDatabase(file, name, { factory: f.factory })
  assert.equal(result.counts.publicationAnchors, 2); assert.equal(result.deleted, true)
  for (const patch of [{ publicationId: 'missing' }, { userId: 'foreign' }, { sourceRevision: 1 }, { range: { from: 1, to: 100 } }]) {
    const bad = structuredClone(data)
    Object.assign(bad.stores.find(s => s.name === 'publicationAnchors').records[0].value, patch)
    assert.throws(() => assertCompatibleBackup(bad))
  }
})

test('aborted v5 upgrade restores the old unique index and all original values', async () => {
  const f = await fixture()
  const factory = { open(name, version) {
    const request = f.factory.open(name, version)
    request.addEventListener('upgradeneeded', () => queueMicrotask(() => request.transaction.abort()))
    return request
  } }
  await assert.rejects(connectDatabase({ factory }))
  const db = await open(f.factory, 'just-writing', 5)
  assert.deepEqual(await readBackupDatabaseSnapshot(db), f.before); db.close()
})
