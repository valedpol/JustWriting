import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const { default: WritingChart } = await server.ssrLoadModule('/src/components/WritingChart.jsx')
after(() => server.close())

test('day axis keeps precise inward endpoint labels, short hours and original data geometry', () => {
  const first = Date.parse('2026-10-05T04:11:00Z')
  const last = Date.parse('2026-10-05T21:07:00Z')
  const chart = { scale: 'day', timeZone: 'Europe/Moscow', sampleCount: 3, points: [
    { start: first, x: first + 3600000, value: -9 },
    { start: first + 3600000, x: last, value: 10 },
  ] }
  const before = structuredClone(chart)
  const dom = new JSDOM(renderToStaticMarkup(createElement(WritingChart, { chart })))
  try {
    const svg = dom.window.document.querySelector('svg')
    const ticks = [...svg.querySelectorAll('.research-time-tick')]
    assert.equal(ticks[0].textContent, '07:11')
    assert.equal(ticks[0].getAttribute('text-anchor'), 'start')
    assert.equal(ticks[0].getAttribute('x'), '55')
    assert.equal(ticks.at(-1).textContent, '00:07')
    assert.equal(ticks.at(-1).getAttribute('text-anchor'), 'end')
    assert.equal(ticks.at(-1).getAttribute('x'), '615')
    assert.ok(ticks.slice(1, -1).every(tick => /^\d{2}$/.test(tick.textContent)))
    assert.ok(!ticks.some(tick => tick.textContent === '00'))
    assert.ok([...svg.querySelectorAll('text')].some(text => text.textContent === 'Время'))
    assert.equal(svg.querySelector('polyline').getAttribute('points'),
      `${55 + 3600000 / (last - first) * 560},190 615,35`)
    assert.deepEqual(chart, before)
  } finally { dom.window.close() }
})

test('month and year keep their existing labels and have no time-axis title', () => {
  for (const scale of ['month', 'year']) {
    const dom = new JSDOM(renderToStaticMarkup(createElement(WritingChart, { chart: { scale, points: [{ x: 1, value: 5 }, { x: 2, value: 10 }] } })))
    try {
      assert.deepEqual([...dom.window.document.querySelectorAll('.research-time-tick')].map(text => text.textContent),
        scale === 'year' ? ['янв', 'фев'] : ['1', '2'])
      assert.ok(!dom.window.document.querySelector('svg').textContent.includes('Время'))
    } finally { dom.window.close() }
  }
})
