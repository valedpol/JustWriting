import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'
import { connectDatabase } from './storage/database.js'
import { createReaderFeedFixture } from './testFixtures/readerFeed.js'

const dom = new JSDOM('<body></body>', { url: 'https://research-counts.test', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement']) globalThis[key] = dom.window[key]
globalThis.IDBKeyRange = IDBKeyRange
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
// Only the explicit isolated runner below may access storage.
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new Error('Working IndexedDB forbidden') } })
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error',
  plugins: [{ name: 'research-counts-isolated-db', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/storage/database.js')) return code.replace('export function transaction(storeNames, mode, run) {',
      'export function transaction(storeNames, mode, run) { return globalThis.__researchCountsTransaction(storeNames, mode, run);')
  } }] })
const { default: Research } = await server.ssrLoadModule('/src/Research.jsx')
after(async () => { delete globalThis.__researchCountsTransaction; await server.close(); dom.window.close() })
const settle = async predicate => {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
  assert.ok(predicate())
}

test('Research derives owner channel counts through the repository, refreshes create/delete and preserves writing data/chart', async t => {
  const db = await connectDatabase({ factory: new IDBFactory(), name: `research-counts-${crypto.randomUUID()}` })
  const accesses = []
  const runTransaction = (names, mode, run) => new Promise((resolve, reject) => {
    accesses.push({ names, mode })
    const tx = db.transaction(names, mode)
    let result, failure
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(failure || tx.error)
    tx.onerror = () => {}
    try { run(tx, value => { result = value }, error => { failure = error; tx.abort() }) }
    catch (error) { failure = error; tx.abort() }
  })
  globalThis.__researchCountsTransaction = runTransaction
  const f = await createReaderFeedFixture({ runTransaction })
  await runTransaction(['settings', 'userDays', 'wordCountSamples'], 'readwrite', tx => {
    tx.objectStore('settings').put({ ...f.profiles[0], timeZone: 'UTC', dayStartMinutes: 0 })
    tx.objectStore('userDays').put({ userId: f.users[0], userDayId: f.texts[0].userDayId,
      dayKey: '2026-10-07', revision: 1, timeZone: 'UTC', dailyWordGoal: 4, goalReached: true })
    for (const [i, wordCount] of [0, 2, 4].entries()) tx.objectStore('wordCountSamples').put({
      sampleId: `sample-${i}`, userId: f.users[0], userDayId: f.texts[0].userDayId,
      timestamp: Date.UTC(2026, 9, 7, 8, i * 5), wordCount,
    })
  })
  const sourceStores = ['settings', 'texts', 'userDays', 'wordCountSamples']
  const dumpSources = () => runTransaction(sourceStores, 'readonly', (tx, done) => {
    const data = {}; done(data)
    for (const store of sourceStores) { const request = tx.objectStore(store).getAll(); request.onsuccess = () => { data[store] = request.result } }
  })
  const before = await dumpSources()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  t.after(async () => { await act(async () => root.unmount()); container.remove(); db.close() })
  const counts = () => [...container.querySelectorAll('.research-publication-totals strong')].map(node => Number(node.textContent))
  const refresh = async expected => {
    accesses.length = 0
    await act(async () => window.dispatchEvent(new dom.window.Event('focus')))
    await settle(() => JSON.stringify(counts()) === JSON.stringify(expected))
    assert.ok(accesses.length > 0)
    assert.ok(accesses.every(access => access.mode === 'readonly'), 'Research refresh never writes counts or source')
  }
  await act(async () => root.render(createElement(Research, { userId: f.users[0], flush: async () => {} })))
  await settle(() => counts().length === 2)
  assert.deepEqual(counts(), [1, 3], 'foreign authors excluded; hidden owner Feed object still counted')
  assert.deepEqual([...container.querySelectorAll('.research-publication-totals span')].map(node => node.textContent), ['в профиле', 'в ленте'])
  assert.equal(container.textContent.includes('в интернете'), false, 'Internet counter is absent even with saved Internet publications')
  assert.equal(container.querySelector('.research-publication-totals').parentElement, container.querySelector('.research-statistics'))
  const day = [...container.querySelectorAll('[aria-label="Дни"] button')].find(node => node.getAttribute('aria-label').includes('есть текст'))
  await act(async () => day.click())
  const chart = container.querySelector('.research-chart').outerHTML
  const calendar = container.querySelector('.research-time').outerHTML
  const writingTotals = container.querySelector('.research-totals').textContent
  const created = await f.repo.createPublications(f.users[0], { source: { ...f.records[0].source, range: { from: 1, to: 10 } }, channels: ['profile', 'feed', 'internet'] })
  await refresh([2, 4])
  await f.repo.deletePublication(f.users[0], created.find(record => record.channel === 'feed').publicationId)
  await refresh([2, 3])
  for (const channel of ['profile', 'feed', 'internet']) {
    for (const record of await f.repo.listOwnPublications(f.users[0], channel)) await f.repo.deletePublication(f.users[0], record.publicationId)
  }
  await refresh([0, 0])
  assert.equal((await f.repo.listFeedPublications()).length, 2, 'other authors remain in Feed')
  assert.equal(container.querySelector('.research-totals').textContent, writingTotals)
  assert.equal(container.querySelector('.research-time').outerHTML, calendar)
  assert.equal(container.querySelector('.research-chart').outerHTML, chart)
  assert.deepEqual(await dumpSources(), before, 'counts and publication lifecycle never mutate the four existing source stores')
})
