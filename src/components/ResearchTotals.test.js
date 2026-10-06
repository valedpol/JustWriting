import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { createLastVerifiedBackupStore } from '../backup/lastVerifiedBackup.js'

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const { default: ResearchTotals } = await server.ssrLoadModule('/src/components/ResearchTotals.jsx')
after(() => server.close())
function totals(n, backupCount) {
  const dom = new JSDOM(renderToStaticMarkup(createElement(ResearchTotals, {
    data: { writingDays: 33, totalWords: 1000, streak: 3, tagCount: n, titleCount: n }, backupCount,
  })))
  const rows = [...dom.window.document.querySelector('.research-totals').children]
    .map(row => [row.querySelector('strong').textContent, row.querySelector('span').textContent])
  dom.window.close()
  return rows
}

test('six totals preserve original order and pluralize semantic and backup counts', () => {
  assert.deepEqual(totals(1, 1), [['33', 'дня письма'], ['1 000', 'слов'], ['3', 'дня подряд'],
    ['1', 'тег'], ['1', 'название'], ['1', 'бэкап']])
  assert.deepEqual(totals(2, 0).slice(3), [['2', 'тега'], ['2', 'названия'], ['0', 'бэкапов']])
  for (const n of [5, 11, 12, 14]) {
    assert.deepEqual(totals(n, 0).slice(3, 5), [[String(n), 'тегов'], [String(n), 'названий']])
  }
})

test('Research backup indicator uses the Account receipt; unverified downloads do not count', () => {
  const entries = new Map()
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) }
  const account = createLastVerifiedBackupStore(storage)
  const research = createLastVerifiedBackupStore(storage)
  assert.equal(totals(0, research.read() ? 1 : 0)[5][0], '0')
  assert.throws(() => account.save({ restoreVerified: false }))
  assert.equal(totals(0, research.read() ? 1 : 0)[5][0], '0')
  account.save({ capturedAt: Date.now(), counts: { texts: 33 }, restoreVerified: true, isolatedRestoreDeleted: true })
  assert.equal(totals(0, research.read() ? 1 : 0)[5][0], '1')
})
