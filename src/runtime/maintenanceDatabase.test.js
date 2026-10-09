import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { memoryLocks, memoryStorage } from './maintenanceTestHelpers.js'

// Install an origin-local adapter before importing the real application gate.
// All actual opens go to a single UUID database, never a working database.
const factory = new IDBFactory(), uuidName = 'just-writing-import-test-' + crypto.randomUUID(), opens = []
Object.defineProperty(globalThis.navigator, 'locks', { value: memoryLocks(), configurable: true })
globalThis.localStorage = memoryStorage()
globalThis.indexedDB = {
  open(name, version) { const target = name === 'just-writing' ? uuidName : name; opens.push(target); return factory.open(target, version) },
}
const { maintenance } = await import('./maintenance.js')
const { connectDatabase, transaction } = await import('../storage/database.js')
const { loadProfile, saveText } = await import('../storage/textRepository.js')
const { resolveToday, endWritingSession } = await import('../storage/dayRepository.js')
const { sampleWordCount } = await import('../storage/wordCountRepository.js')
const { saveProfileSetting } = await import('../storage/settingsRepository.js')
const { loadPublicIdentity } = await import('../storage/publicIdentityRepository.js')
const { saveSemanticMarkup } = await import('../storage/semanticRepository.js')

test('real repository gate drains accepted writes and blocks every ordinary repository write plus schema opening', async () => {
  await maintenance.registerApplication()
  const db = await connectDatabase({ name: uuidName }); db.close()
  await transaction(['settings'], 'readwrite', tx => tx.objectStore('settings').add({ key: 'before', value: 1 }))
  let flushed = false
  const unregister = maintenance.registerFlush(async () => {
    await transaction(['settings'], 'readwrite', tx => tx.objectStore('settings').add({ key: 'pending', value: 2 }))
    flushed = true
  })
  await maintenance.enter()
  try {
    assert.equal(flushed, true)
    const read = () => transaction(['settings'], 'readonly', (tx, done) => { tx.objectStore('settings').getAll().onsuccess = e => done(e.target.result) })
    const before = await read(), openCount = opens.length
    const attempted = await Promise.allSettled([
      loadProfile(), resolveToday({ userId: 'u', timeZone: 'Europe/Moscow', dayStartMinutes: 0, dayPolicyVersion: 2 }),
      endWritingSession('u', 'session'), sampleWordCount('u', 'day', 'session'),
      saveProfileSetting('u', 'displayName', 'Changed'),
      saveProfileSetting('u', 'publicNickname', 'Changed'), saveProfileSetting('u', 'allowNameDisclosure', true),
      saveProfileSetting('u', 'profileVisible', true), saveProfileSetting('u', 'about', 'Public about'),
      saveProfileSetting('u', 'links', [{ label: 'Site', url: 'https://example.org' }]),
      saveProfileSetting('u', 'pinnedPublicationId', null),
      loadPublicIdentity('u'), saveSemanticMarkup('u', { textId: 't', userId: 'u' }, []),
      saveText({ userId: 'u', dayKey: '2027-03-10' }, null, 'New text'),
      connectDatabase({ name: 'just-writing-import-test-' + crypto.randomUUID() }),
      transaction(['settings'], 'readwrite', () => assert.fail('transaction callback must not run')),
    ])
    assert.ok(attempted.every(r => r.status === 'rejected' && /Maintenance/.test(r.reason.message)))
    assert.deepEqual(await read(), before)
    assert.equal(opens.length, openCount)
    assert.ok(opens.every(n => n !== 'just-writing'))
  } finally { unregister(); await maintenance.exit() }
})
