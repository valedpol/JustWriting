import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayValueTicks, dayHourTicks } from './writingChartAxes.js'

test('day has five evenly positioned labels with rounded intermediate values', () => {
  assert.deepEqual(dayValueTicks(101).map(t => t.label), [101, 76, 51, 25, 0])
  assert.deepEqual(dayValueTicks(101).map(t => t.value), [101, 75.75, 50.5, 25.25, 0])
  assert.equal(dayValueTicks(1).length, 5)
})
test('day hour ticks use real local hours, including fractional UTC offsets', () => {
  const first = Date.parse('2026-09-30T05:10:00Z')
  const last = Date.parse('2026-09-30T07:20:00Z')
  assert.deepEqual(dayHourTicks(first, last, 'Europe/Moscow'), [Date.parse('2026-09-30T06:00:00Z'), Date.parse('2026-09-30T07:00:00Z')])
  assert.deepEqual(dayHourTicks(first, last, 'Asia/Kolkata'), [Date.parse('2026-09-30T05:30:00Z'), Date.parse('2026-09-30T06:30:00Z')])
})

test('signed day ticks cover actual extrema and include the zero axis exactly once', () => {
  for (const [low, high] of [[-83, 101], [-100, 0], [0, 100], [0, 0]]) {
    const ticks = dayValueTicks(high, low)
    assert.equal(ticks[0].value, high)
    assert.equal(ticks.at(-1).value, low)
    assert.equal(ticks.filter(t => t.value === 0).length, 1)
    assert.ok(ticks.every(t => t.value >= low && t.value <= high))
  }
})
