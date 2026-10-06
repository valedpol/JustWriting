import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true, url: 'https://archive.test' })
for (const key of ['window', 'document', 'HTMLElement', 'getComputedStyle']) globalThis[key] = dom.window[key]
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new Error('IndexedDB forbidden in calendar test') } })
const style = document.createElement('style')
style.textContent = readFileSync(new URL('./MyTexts.css', import.meta.url), 'utf8') + readFileSync(new URL('./components/ArchiveCalendar.css', import.meta.url), 'utf8')
document.head.append(style)
const { createRoot } = await import('react-dom/client')
const records = [{ textId: 'a', dayKey: '2025-09-26', content: 'Первый' },
  { textId: 'b', dayKey: '2026-09-26', content: 'Второй' },
  { textId: 'c', dayKey: '2026-10-03', content: 'Третий' }]
globalThis.__archiveRecords = records
let flushEditor = async () => {}
globalThis.__archiveFlush = () => flushEditor()
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error',
  plugins: [{ name: 'archive-calendar-test', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/storage/textRepository.js')) return 'export const listTexts = async () => globalThis.__archiveRecords'
    if (id.endsWith('/src/components/ArchiveWritingEntry.jsx')) return `import { forwardRef, useImperativeHandle } from 'react';
      export default forwardRef(function Entry({record}, ref) {
        useImperativeHandle(ref, () => ({ flush: globalThis.__archiveFlush, toggleSelection() {} }));
        return <div className="test-open-editor"><span>{record.content}</span><div className="selection-panel">B I U</div></div>
      })`
  } }] })
const { default: MyTexts } = await server.ssrLoadModule('/src/MyTexts.jsx')
after(async () => { delete globalThis.__archiveRecords; delete globalThis.__archiveFlush; await server.close(); dom.window.close() })

test('calendar filters only the feed, drains saves before hiding, clears selection/panel and resets period on reopen', async () => {
  const before = structuredClone(records)
  const container = document.createElement('div'), host = document.createElement('aside')
  document.body.append(container, host)
  const root = createRoot(container)
  const render = () => root.render(createElement(MyTexts, { userId: 'u', flush: async () => {}, onTotalWords() {}, metadataHost: host }))
  const ids = () => [...container.querySelectorAll('[data-text-id]')].map(node => node.dataset.textId)
  const click = async node => {
    assert.ok(node); await act(async () => node.click())
    const heading = getComputedStyle(container.querySelector('.archive-calendar-heading'))
    assert.equal(heading.height, '28px', 'heading height is independent of selected period')
    assert.equal(heading.lineHeight, '20px')
    assert.equal(heading.alignItems, 'center')
  }
  const year = value => [...container.querySelectorAll('[aria-label="Годы"] button')].find(node => node.textContent === value)
  const openCalendar = () => container.querySelector('[aria-controls="archive-calendar"]')
  const clear = () => container.querySelector('[aria-label="Снять выбранный период"]')
  try {
    await act(async () => render())
    assert.deepEqual(ids(), ['a', 'b', 'c'])
    await click(container.querySelector('[data-text-id=a] button'))
    const range = document.createRange(); range.selectNodeContents(container.querySelector('.test-open-editor span'))
    window.getSelection().addRange(range)
    await click(openCalendar())
    const pointer = new dom.window.Event('pointerover', { bubbles: true })
    Object.defineProperty(pointer, 'pointerType', { value: 'mouse' })
    await act(async () => year('2026').dispatchEvent(pointer))
    assert.equal(document.querySelector('[role=tooltip]').textContent, '2 слова', 'year tooltip sums the full archive')
    await act(async () => year('2026').dispatchEvent(new dom.window.Event('pointerout', { bubbles: true })))
    assert.equal(document.querySelector('[role=tooltip]'), null)
    let resolve, flushCalls = 0
    flushEditor = () => { flushCalls++; return new Promise(done => { resolve = done }) }
    container.querySelector('.archive-scroll').scrollTop = 250
    await click(year('2026'))
    assert.equal(flushCalls, 1)
    assert.deepEqual(ids(), ['a', 'b', 'c'], 'pending save keeps entry mounted')
    assert.equal(container.querySelector('fieldset').disabled, true)
    await act(async () => resolve())
    assert.deepEqual(ids(), ['b', 'c'])
    assert.equal(container.querySelector('.archive-scroll').scrollTop, 0)
    assert.equal(window.getSelection().rangeCount, 0)
    assert.equal(container.querySelector('.selection-panel'), null)
    assert.ok(year('2025'), 'calendar retains the full archive')
    await click(openCalendar())
    assert.equal(container.querySelector('fieldset'), null)
    assert.ok(clear(), 'collapsed calendar retains active period')
    await click(openCalendar())
    await click([...container.querySelectorAll('[aria-label="Месяцы"] button')].find(node => node.textContent === 'Сентябрь'))
    assert.deepEqual(ids(), ['b'])
    await click(container.querySelector('[aria-label="Дни"] button:nth-child(26)'))
    assert.deepEqual(ids(), ['b'])
    const activeDay = container.querySelector('.research-day-button[aria-pressed=true]')
    assert.equal(getComputedStyle(activeDay).textDecoration, 'none', 'active day button must not add a second underline')
    assert.equal(getComputedStyle(activeDay.querySelector('.research-day-number')).textDecoration, 'underline')
    assert.ok(activeDay.querySelector('.research-day-cell.has-text'), 'data marker remains independent of selection')
    await click(container.querySelector('[data-text-id=b] button'))
    assert.ok(host.querySelector('.archive-actions'))
    await click(host.querySelector('.archive-actions button'))
    assert.equal(container.querySelector('.test-open-editor'), null)
    assert.equal(host.querySelector('.archive-actions'), null)
    await click(container.querySelector('[aria-label="Дни"] button:nth-child(25)'))
    assert.deepEqual(ids(), [])
    assert.match(container.textContent, /В выбранном периоде текстов нет/)
    await click(clear())
    assert.deepEqual(ids(), ['a', 'b', 'c'])
    // Failed save must leave criteria, editor and selection intact.
    await click(container.querySelector('[data-text-id=a] button'))
    flushEditor = async () => { throw new Error('save failed') }
    await click(year('2026'))
    assert.deepEqual(ids(), ['a', 'b', 'c'])
    assert.equal(container.querySelector('[role=alert]').textContent, 'save failed')
    assert.ok(container.querySelector('.test-open-editor'))
    flushEditor = async () => {}
    await click(year('2026'))
    await act(async () => root.render(null))
    await act(async () => render())
    assert.deepEqual(ids(), ['a', 'b', 'c'])
    assert.equal(clear(), null)
    assert.deepEqual(records, before, 'navigation never changes archive records')
  } finally { await act(async () => root.unmount()); container.remove(); host.remove() }
})


test('calendar active period and has-data indicators occupy separate levels', () => {
  const rules = [...style.sheet.cssRules]
  const rule = selector => rules.find(item => item.selectorText === selector).style
  assert.equal(rule('.research-time .research-month-button[aria-pressed="true"]').textDecoration, 'none')
  const active = rule('.research-month-button[aria-pressed="true"]::after')
  const marker = rule('.research-month-mark')
  assert.ok(parseFloat(active.bottom) > parseFloat(marker.bottom) + parseFloat(marker.height), 'active line is above data marker with a gap')
  assert.equal(rule('.research-time .research-day-button').gap, '7px')
  assert.equal(rule('.research-time .research-day-button[aria-pressed="true"] .research-day-number').getPropertyValue('text-underline-offset'), '3px')
})
