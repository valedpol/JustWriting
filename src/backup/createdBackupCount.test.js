import test from 'node:test'
import assert from 'node:assert/strict'
import { createCreatedBackupCountStore, CREATED_BACKUP_COUNT_KEY } from './createdBackupCount.js'

test('creation count persists independently of verification and refuses corrupt or unwritable storage', () => {
  const entries = new Map()
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
  const store = createCreatedBackupCountStore(storage)
  assert.equal(store.read(), 0)
  assert.equal(store.increment(), 1)
  assert.equal(createCreatedBackupCountStore(storage).increment(), 2)
  assert.equal(store.read(), 2)
  for (const invalid of ['broken', '-1', '1.5', 'null']) {
    entries.set(CREATED_BACKUP_COUNT_KEY, invalid)
    assert.throws(() => store.increment())
    assert.equal(entries.get(CREATED_BACKUP_COUNT_KEY), invalid)
  }
  assert.throws(() => createCreatedBackupCountStore(null).increment())
  assert.throws(() => createCreatedBackupCountStore({ getItem: () => '2', setItem() { throw new Error('quota') } }).increment(), /quota/)
})
