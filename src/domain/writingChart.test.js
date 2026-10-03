import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writingChart, periodScale } from './writingChart.js'

const data = () => ({
  entries: new Map([
    ['2026-09-01', { words: 10, day: { userDayId: 'a', timeZone: 'UTC' } }],
    ['2026-09-03', { words: 20, day: { userDayId: 'b', timeZone: 'UTC' } }],
    ['2026-01-05', { words: 7, day: { userDayId: 'c', timeZone: 'UTC' } }],
  ]), samples: [],
})
test('day uses signed changes between actual sorted observations, preserving zeros and gaps', () => {
  const source = data()
  source.samples = [[1000, 610], [301000, 620], [601000, 640], [2000000, 641], [2300000, 641], [2600000, 600]]
    .reverse().map(([timestamp, wordCount]) => ({ userDayId: 'a', timestamp, wordCount }))
  const chart = writingChart(source, '2026-09-01', '2026-09-30')
  assert.deepEqual(chart.points.map((p) => p.value), [10, 20, 1, 0, -41])
  assert.deepEqual(chart.points.map((p) => [p.start, p.x]), [[1000, 301000], [301000, 601000], [601000, 2000000], [2000000, 2300000], [2300000, 2600000]])
})
test('zero or one sample yields no tempo; saved text never becomes an extra point', () => {
  const source = data()
  assert.deepEqual(writingChart(source, '2026-09-01', '2026-09-30').points, [])
  source.samples.push({ userDayId: 'a', timestamp: 1000, wordCount: 5 })
  const chart = writingChart(source, '2026-09-01', '2026-09-30')
  assert.equal(chart.sampleCount, 1)
  assert.deepEqual(chart.points, [])
})
test('month uses daily saved volume and zeros, stopping at current calendar date', () => {
  const chart = writingChart(data(), '2026-09', '2026-09-04')
  assert.deepEqual(chart.points.map((p) => p.value), [10, 0, 20, 0])
  assert.deepEqual(chart.points.map((p) => p.x), [1, 2, 3, 4])
  assert.equal(writingChart(data(), '2026-08', '2026-09-04').points.length, 31)
  assert.equal(writingChart(data(), '2024-02', '2026-09-04').points.length, 29)
})
test('year sums saved monthly volumes without accumulation and excludes future months', () => {
  const chart = writingChart(data(), '2026', '2026-09-04')
  assert.deepEqual(chart.points.map((p) => p.value), [7, 0, 0, 0, 0, 0, 0, 0, 30])
  assert.equal(writingChart(data(), '2025', '2026-09-04').points.length, 12)
})
test('navigation period alone determines year → month → day scale without changing data', () => {
  const source = data()
  const before = structuredClone(source)
  for (const [period, scale] of [['2026', 'year'], ['2026-09', 'month'], ['2026-09-01', 'day']]) {
    assert.equal(periodScale(period), scale)
    assert.equal(writingChart(source, period, '2026-09-30').scale, scale)
  }
  assert.deepEqual(source, before)
})
