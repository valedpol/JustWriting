import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement, useLayoutEffect, useState } from 'react'
import { timerMinutes, timerCountdown } from '../hooks/useWritingTimer.js'

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'HTMLElement']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const { default: WritingTimer } = await server.ssrLoadModule('/src/components/WritingTimer.jsx')
const { useWritingTimer } = await server.ssrLoadModule('/src/hooks/useWritingTimer.js')
after(async () => { await server.close(); dom.window.close() })

test('timer accepts only whole minutes 1–999 and displays unbounded minute digits', () => {
  for (const value of ['', '0', '000', '1000', '-1', '1.5', '1e2', '+1', ' 1', '1 ', 'abc', '1:00']) assert.equal(timerMinutes(value), null, value)
  for (const [value, expected] of [['1', 1], ['99', 99], ['120', 120], ['999', 999]]) assert.equal(timerMinutes(value), expected)
  assert.equal(timerCountdown(120 * 60_000), '120:00')
  assert.equal(timerCountdown(999 * 60_000), '999:00')
  assert.equal(timerCountdown(59_001), '01:00')
  assert.equal(timerCountdown(59_000), '00:59')
  assert.equal(timerCountdown(0), '00:00')
})

test('timer setup shares the search slot; deadline freezes session delta; only ОК closes result; session is not persisted', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 1_800_000_000_000 })
  const container = document.createElement('div'), area = document.createElement('aside'), icon = document.createElement('button')
  document.body.append(container, area, icon)
  area.getBoundingClientRect = () => ({ left: 800, right: 1000, width: 200 })
  icon.getBoundingClientRect = () => ({ left: 930, width: 28, bottom: 48 })
  const anchor = { current: icon }, root = createRoot(container)
  let words = 100, api, openSetup
  const storageBefore = [dom.window.localStorage.length, dom.window.sessionStorage.length]
  function Harness() {
    const timer = useWritingTimer(() => words)
    const [setupOpen, setSetup] = useState(true)
    useLayoutEffect(() => { api = timer; openSetup = () => setSetup(true) }, [timer])
    return createElement(WritingTimer, { timer, setupOpen, anchor, metadataHost: area,
      onStart: value => { if (timer.start(value)) setSetup(false) }, onClose: () => setSetup(false) })
  }
  const input = () => document.querySelector('[aria-label="Количество минут"]')
  const fill = async value => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input(), value)
    input().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  const submit = () => act(async () => document.querySelector('#writing-timer-setup').requestSubmit())
  const advance = milliseconds => act(async () => t.mock.timers.tick(milliseconds))
  const click = element => act(async () => element.click())
  try {
    await act(async () => root.render(createElement(Harness)))
    assert.equal(input(), document.activeElement)
    const setup = document.querySelector('#writing-timer-setup')
    assert.equal(setup.style.left, '835px'); assert.equal(setup.style.width, '130px'); assert.equal(setup.style.top, '58px')
    for (const value of ['0', '1000', '-1', '1.5', 'abc']) {
      await fill(value); await submit()
      assert.equal(api.running, false)
      assert.equal(input().getAttribute('aria-invalid'), 'true')
    }
    await fill('1'); await submit()
    assert.equal(input(), null)
    assert.equal(document.querySelector('[role=timer]').textContent, '01:00')
    assert.equal(document.querySelector('[role=timer]').style.left, '944px', 'countdown center follows the icon, not the setup slot')
    assert.equal(document.querySelector('[role=dialog]'), null)
    words = 400
    await advance(1000)
    assert.equal(document.querySelector('[role=timer]').textContent, '00:59')
    words = 790
    await advance(59_000)
    assert.equal(api.running, false)
    assert.equal(document.querySelector('[role=timer]'), null)
    const result = document.querySelector('[role=dialog]')
    assert.match(result.textContent, /Время закончилось\.Набрано 690 слов/)
    assert.equal(result.querySelectorAll('button').length, 1)
    assert.equal(result.querySelector('button').textContent, 'ОК')
    assert.equal(result.style.left, '835px'); assert.equal(result.style.top, '58px')
    await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await click(document.body)
    assert.equal(document.querySelector('[role=dialog]'), result, 'Esc and outside clicks cannot dismiss the result')
    words = 900
    await advance(10_000)
    assert.match(result.textContent, /690 слов/, 'finished result never keeps counting')
    assert.equal(api.start('1'), false, 'another session cannot replace an unacknowledged result')
    await click(result.querySelector('.writing-timer-ok'))
    assert.equal(api.result, null)
    await act(async () => openSetup())
    await fill('120'); await submit()
    assert.equal(document.querySelector('[role=timer]').textContent, '120:00')
    await act(async () => root.render(null))
    await act(async () => root.render(createElement(Harness)))
    assert.equal(api.running, false, 'reopen has no saved timer')
    assert.equal(api.result, null)
    await fill('1'); await submit()
    words = 1
    await advance(60_000)
    assert.match(document.querySelector('[role=dialog]').textContent, /Набрано 0 слов/)
    await click(document.querySelector('.writing-timer-ok'))
    assert.equal(document.querySelector('[role=dialog]'), null)
    assert.deepEqual([dom.window.localStorage.length, dom.window.sessionStorage.length], storageBefore)
    await act(async () => openSetup())
    await fill('15')
    await act(async () => input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(input(), null)
    await act(async () => openSetup())
    assert.equal(input().value, '', 'closing setup clears the draft')
  } finally { await act(async () => root.unmount()); container.remove(); area.remove(); icon.remove(); t.mock.timers.reset() }
})
