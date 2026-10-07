import { maintenance } from '../runtime/maintenance.js'
import { encode, decode } from './backupCodec.js'
import { bytesHash } from '../utils/files.js'

import { databaseSchema } from '../storage/databaseSchema.js'
const PREFIX = 'just-writing-backup-verification-'
const REGISTRY = Symbol.for('just-writing.backup-isolated-databases.v1')
if (!Object.hasOwn(globalThis, REGISTRY)) Object.defineProperty(globalThis, REGISTRY, { value: new Set() })
const isolated = globalThis[REGISTRY]
export function registerBackupFlush(flush) {
  return maintenance.registerFlush(flush)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const hash = value => bytesHash(new TextEncoder().encode(JSON.stringify(value)))

function open(factory, name, version, upgrade) {
  return new Promise((resolve, reject) => {
    let failed = false
    const r = factory.open(name, version)
    r.onupgradeneeded = () => {
      try { if (upgrade) upgrade(r.result, r.transaction); else r.transaction.abort() }
      catch (error) { r.transaction.abort(); reject(error) }
    }
    r.onerror = () => reject(r.error)
    r.onblocked = () => { failed = true; reject(new Error('Database blocked')) }
    r.onsuccess = () => { if (failed) r.result.close(); else resolve(r.result) }
  })
}
export function readBackupDatabaseSnapshot(db) {
  return new Promise((resolve, reject) => {
    let storeNames
    try { storeNames = Object.keys(databaseSchema(db.version).stores) } catch (error) { reject(error); return }
    if (!same(Array.from(db.objectStoreNames).sort(), [...storeNames].sort())) { reject(new Error('Unexpected stores')); return }
    const tx = db.transaction(storeNames, 'readonly'), stores = []
    for (const name of storeNames) {
      const s = tx.objectStore(name)
      const entry = { name, keyPath: s.keyPath, autoIncrement: s.autoIncrement, indexes: Array.from(s.indexNames, name => {
        const i = s.index(name); return { name, keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry }
      }), records: [], count: 0 }
      stores.push(entry)
      s.count().onsuccess = e => { entry.count = e.target.result }
      s.openCursor().onsuccess = e => { const c = e.target.result; if (c) { entry.records.push({ key: c.primaryKey, value: c.value }); c.continue() } }
    }
    tx.oncomplete = () => resolve({ databaseVersion: db.version, stores })
    tx.onabort = () => reject(tx.error || new Error('Snapshot aborted'))
    tx.onerror = () => {}
  })
}

export async function captureBackup({ flush, factory = indexedDB, origin = location.origin } = {}) {
  if (!flush && !maintenance.hasRegisteredFlush()) throw new Error('A live application flush is required')
  if (flush) await flush(); else await maintenance.flushPending()
  const existing = (await factory.databases()).find(d => d.name === 'just-writing')
  if (!existing) throw new Error('Working database absent; refusing creation')
  const db = await open(factory, existing.name, existing.version)
  let data
  try { data = await readBackupDatabaseSnapshot(db) } finally { db.close() }
  const payload = await encode({ ...data, origin, databaseName: 'just-writing', capturedAt: Date.now() })
  const storeHashes = await Promise.all(data.stores.map(async s => ({ name: s.name, sha256: await hash(await encode(s)) })))
  const envelope = { format: 'just-writing-backup', formatVersion: databaseSchema(data.databaseVersion).formatVersion, payload, storeHashes, sha256: await hash({ payload, storeHashes }) }
  const file = new Blob([JSON.stringify(envelope)], { type: 'application/json' })
  await validateBackup(file) // Re-read the produced file bytes before returning.
  return file
}

export async function validateBackup(file) {
  const e = JSON.parse(await file.text())
  if (e.format !== 'just-writing-backup' || ![1, 2].includes(e.formatVersion) || e.sha256 !== await hash({ payload: e.payload, storeHashes: e.storeHashes })) throw new Error('Invalid backup integrity/format')
  const data = decode(e.payload)
  if (!same(await encode(data), e.payload)) throw new Error('Invalid or lossy backup encoding')
  const schema = databaseSchema(data.databaseVersion)
  if (e.formatVersion !== schema.formatVersion || data.databaseName !== 'just-writing' || typeof data.origin !== 'string' || !Number.isInteger(data.databaseVersion) || data.databaseVersion < 1 || !same(data.stores.map(s => s.name), Object.keys(schema.stores))) throw new Error('Invalid backup metadata/schema')
  if (!Array.isArray(e.storeHashes) || e.storeHashes.length !== data.stores.length) throw new Error('Invalid store integrity/count')
  for (const [i, s] of data.stores.entries()) {
    if (s.count !== s.records.length || e.storeHashes[i]?.name !== s.name || e.storeHashes[i]?.sha256 !== await hash(await encode(s))) throw new Error('Invalid store integrity/count')
  }
  return data
}

export async function restoreToNewDatabase(file, { factory = indexedDB } = {}) {
  const data = await validateBackup(file)
  const name = PREFIX + crypto.randomUUID()
  if ((await factory.databases()).some(d => d.name === name)) throw new Error('Isolated name collision')
  const db = await open(factory, name, data.databaseVersion, db => {
    for (const s of data.stores) {
      const store = db.createObjectStore(s.name, { keyPath: s.keyPath, autoIncrement: s.autoIncrement })
      for (const i of s.indexes) store.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry })
    }
  })
  isolated.add(name)
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(Object.keys(databaseSchema(data.databaseVersion).stores), 'readwrite')
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new Error('Restore aborted')); tx.onerror = () => {}
      try { for (const s of data.stores) for (const r of s.records) {
        const store = tx.objectStore(s.name)
        if (s.keyPath === null) store.add(r.value, r.key); else store.add(r.value)
      } } catch (error) { tx.abort(); reject(error) }
    })
  } finally { db.close() }
  return name
}

export async function verifyRestoredDatabase(file, name, { factory = indexedDB, deleteAfterSuccess = true } = {}) {
  if (!name.startsWith(PREFIX) || !isolated.has(name)) throw new Error('Only a database created by this verification session is allowed')
  const data = await validateBackup(file)
  const db = await open(factory, name, data.databaseVersion)
  let restored
  try { restored = await readBackupDatabaseSnapshot(db) } finally { db.close() }
  if (!same(await encode(restored), await encode({ databaseVersion: data.databaseVersion, stores: data.stores }))) throw new Error('Restored schema/keys/counts/values differ')
  if (deleteAfterSuccess) await new Promise((resolve, reject) => {
    const r = factory.deleteDatabase(name); r.onsuccess = resolve; r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error('Cleanup blocked'))
  })
  isolated.delete(name)
  return { verified: true, databaseName: name, databaseVersion: data.databaseVersion,
    counts: Object.fromEntries(data.stores.map(s => [s.name, s.count])), deleted: deleteAfterSuccess }
}
