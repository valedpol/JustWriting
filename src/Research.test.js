import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { createLastVerifiedBackupStore } from './backup/lastVerifiedBackup.js'

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true, url: 'https://research.test' })
for (const key of ['window', 'document', 'HTMLElement']) globalThis[key] = dom.window[key]
const calendarStyle = document.createElement('style')
calendarStyle.textContent = readFileSync(new URL('./components/ArchiveCalendar.css', import.meta.url), 'utf8') + readFileSync(new URL('./Research.css', import.meta.url), 'utf8')
document.head.append(calendarStyle)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// Full page rendering must not touch any IndexedDB, including the working DB.
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new Error('IndexedDB forbidden in Research render test') } })
const { createRoot } = await import('react-dom/client')
let loadSnapshot
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error',
  plugins: [{ name: 'research-test-repository', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/storage/researchRepository.js')) return 'export const loadResearch = userId => globalThis.__researchRenderLoad(userId)'
    if (id.endsWith('/src/storage/publicationRepository.js')) return 'export const listOwnPublications = async () => []'
  } }] })
globalThis.__researchRenderLoad = userId => loadSnapshot(userId)
const { default: Research } = await server.ssrLoadModule('/src/Research.jsx')
after(async () => { delete globalThis.__researchRenderLoad; await server.close(); dom.window.close() })

test('full Research page renders after asynchronous loading, with word caption, six totals and navigation', async () => {
  for (const backupCount of [0, 1]) {
    dom.window.localStorage.clear()
    if (backupCount) createLastVerifiedBackupStore().save({ capturedAt: Date.now(), counts: { texts: 1 },
      restoreVerified: true, isolatedRestoreDeleted: true })
    const dayKey = new Date().toISOString().slice(0, 10)
    const snapshot = { profile: { userId: 'u', timeZone: 'UTC', dayStartMinutes: 0 },
      days: [{ userId: 'u', userDayId: 'day', dayKey }],
      texts: [{ userId: 'u', userDayId: 'day', content: 'Один два три', semanticMarkup: [
        { kind: 'tag', value: 'Тег' }, { kind: 'title', value: 'Название' },
      ] }], samples: [] }
    let resolveLoad, flushCount = 0
    const pending = new Promise(resolve => { resolveLoad = resolve })
    loadSnapshot = userId => { assert.equal(userId, 'u'); return pending }
    const errors = []
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container, { onUncaughtError: error => errors.push(error) })
    try {
      await act(async () => root.render(createElement(Research, { userId: 'u', flush: async () => { flushCount++ } })))
      assert.equal(container.querySelector('[role=status]').textContent, 'Загружаю…')
      await act(async () => resolveLoad(snapshot))
      assert.deepEqual(errors, [], 'full render must not raise runtime errors')
      assert.equal(flushCount, 1)
      assert.equal(container.querySelector('.research-day p').textContent, '3 слов')
      assert.equal(container.querySelector('.research-day h2').textContent, 'Темп письма')
      const metadata = container.querySelector('.research-day-metadata')
      assert.ok(metadata.contains(container.querySelector('.research-day h1')))
      assert.ok(!metadata.contains(container.querySelector('.research-day h2')))
      assert.equal(window.getComputedStyle(container.querySelector('.research-day-heading')).display, 'grid')
      const totals = [...container.querySelectorAll('.research-totals > div')]
      assert.equal(totals.length, 6)
      assert.deepEqual(totals.map(item => item.querySelector('strong').textContent), ['1', '3', '1', '1', '1', String(backupCount)])
      assert.deepEqual([...container.querySelectorAll('.research-publication-totals strong')].map(node => node.textContent), ['0', '0'])
      assert.equal(container.textContent.includes('в интернете'), false)
      assert.equal(container.querySelectorAll('.research-time-row').length, 3)
      const monthButton = container.querySelector('.research-time-row[aria-label="Месяцы"] button[aria-pressed=true]')
      await act(async () => monthButton.click())
      assert.deepEqual(errors, [])
      assert.equal(container.querySelector('.research-day p').textContent, '3 слов')
      assert.ok(container.querySelector('.research-chart'))
      assert.equal(container.querySelectorAll('[aria-label="Месяцы"] button').length, Number(dayKey.slice(5, 7)))
      assert.equal(container.querySelectorAll('[aria-label="Дни"] button').length, new Date(Date.UTC(Number(dayKey.slice(0, 4)), Number(dayKey.slice(5, 7)), 0)).getUTCDate())
      await act(async () => container.querySelector('[aria-label="Годы"] button').click())
      assert.equal(container.querySelector('.research-day h1').textContent.trim(), dayKey.slice(0, 4))
      assert.equal(container.querySelector('.research-day p').textContent, '3 слов')
      const todayButton = [...container.querySelectorAll('[aria-label="Дни"] button')].find(button => button.getAttribute('aria-label').includes('есть текст'))
      await act(async () => todayButton.click())
      assert.equal(container.querySelector('.research-day p').textContent, '3 слов')
      assert.equal(todayButton.getAttribute('aria-pressed'), 'true')
      assert.equal(window.getComputedStyle(todayButton).textDecoration, 'none', 'only the day number has an underline')
      assert.equal(window.getComputedStyle(todayButton.querySelector('.research-day-number')).textDecoration, 'underline')
      assert.ok(todayButton.querySelector('.research-day-cell.has-text'))
      assert.deepEqual(errors, [])
    } finally {
      await act(async () => root.unmount()); container.remove()
    }
  }
})
