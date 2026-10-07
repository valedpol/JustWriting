import test from 'node:test'
import assert from 'node:assert/strict'
import { createLastVerifiedBackupStore, LAST_VERIFIED_BACKUP_KEY } from './lastVerifiedBackup.js'

const metadata = { capturedAt: 1791269520000, filename: 'backup.json', byteSize: 123,
  sha256: 'a'.repeat(64), dbVersion: 4, origin: 'http://localhost:5173',
  counts: { settings: 2, texts: 36, userDays: 36, wordCountSamples: 169 },
  restoreVerified: true, isolatedRestoreDeleted: true, isolatedRestoreName: 'UUID' }

test('persistent receipt reopens in a new store instance and contains only metadata', () => {
  const entries = new Map()
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
  const store = createLastVerifiedBackupStore(storage)
  assert.equal(store.read(), null)
  const saved = store.save({ ...metadata, file: 'do not store', stores: 'do not store', maintenanceToken: 'do not store' }, 1791270000000)
  assert.deepEqual(createLastVerifiedBackupStore(storage).read(), saved)
  assert.equal(saved.verifiedAt, 1791270000000)
  assert.equal(saved.counts.texts, 36)
  assert.equal(saved.file, undefined)
  assert.equal(saved.stores, undefined)
  assert.equal(saved.maintenanceToken, undefined)
  const previous = entries.get(LAST_VERIFIED_BACKUP_KEY)
  assert.throws(() => store.save({ ...metadata, restoreVerified: false }))
  assert.throws(() => store.save({ ...metadata, isolatedRestoreDeleted: false }))
  assert.equal(entries.get(LAST_VERIFIED_BACKUP_KEY), previous)
  store.save({ ...metadata, filename: 'next.json' })
  assert.equal(createLastVerifiedBackupStore(storage).read().filename, 'next.json')
})

test('unavailable or malformed metadata does not claim a successful backup', () => {
  assert.equal(createLastVerifiedBackupStore({ getItem: () => '{bad' }).read(), null)
  assert.equal(createLastVerifiedBackupStore({ getItem() { throw new Error('denied') } }).read(), null)
  assert.throws(() => createLastVerifiedBackupStore(null).save(metadata))
})

test('v2 receipt persists format version and fifth store count while legacy receipts remain readable', () => {
  const entries = new Map()
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
  const store = createLastVerifiedBackupStore(storage)
  store.save(metadata)
  assert.equal(store.read().dbVersion, 4)
  assert.equal(Object.hasOwn(store.read(), 'formatVersion'), false)
  store.save({ ...metadata, dbVersion: 5, formatVersion: 2, counts: { ...metadata.counts, publications: 3 } })
  const reopened = createLastVerifiedBackupStore(storage).read()
  assert.equal(reopened.formatVersion, 2)
  assert.equal(reopened.counts.publications, 3)
})
