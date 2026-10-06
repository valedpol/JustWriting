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
  assert.deepEqual(dayHourTicks(first, last, 'Europe/Moscow'), [first, Date.parse('2026-09-30T06:00:00Z'), Date.parse('2026-09-30T07:00:00Z'), last])
  assert.deepEqual(dayHourTicks(first, last, 'Asia/Kolkata'), [first, Date.parse('2026-09-30T05:30:00Z'), Date.parse('2026-09-30T06:30:00Z'), last])
})

test('day axis includes first and last save times alongside full hours', () => {
  const first = Date.parse('2026-10-05T06:14:00Z')
  const last = Date.parse('2026-10-05T11:12:00Z')
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
  assert.deepEqual(dayHourTicks(first, last, 'Europe/Moscow').map(timestamp => formatter.format(timestamp)),
    ['09:14', '10:00', '11:00', '12:00', '13:00', '14:12'])
})

test('actual endpoint labels take priority over nearby hours at both ends', () => {
  const first = Date.parse('2026-10-05T06:58:00Z')
  const last = Date.parse('2026-10-05T11:02:00Z')
  assert.deepEqual(dayHourTicks(first, last, 'Europe/Moscow'), [
    first, Date.parse('2026-10-05T08:00:00Z'), Date.parse('2026-10-05T09:00:00Z'),
    Date.parse('2026-10-05T10:00:00Z'), last,
  ])
})

test('endpoint clearance depends on plotted distance, preserving endpoints on narrow axes', () => {
  const first = Date.parse('2026-10-05T06:14:00Z')
  const last = Date.parse('2026-10-05T11:12:00Z')
  const nearFirst = Date.parse('2026-10-05T07:00:00Z')
  assert.ok(dayHourTicks(first, last, 'Europe/Moscow', 560).includes(nearFirst))
  assert.ok(!dayHourTicks(first, last, 'Europe/Moscow', 200).includes(nearFirst))
  assert.deepEqual(dayHourTicks(first, last, 'Europe/Moscow', 80), [first, last])
})

test('full-hour endpoints appear once, preserving exact save timestamps', () => {
  const first = Date.parse('2026-10-05T06:00:00Z')
  const last = Date.parse('2026-10-05T07:00:13Z')
  assert.deepEqual(dayHourTicks(first, last, 'Europe/Moscow'), [first, last])
  assert.deepEqual(dayHourTicks(first, first, 'Europe/Moscow'), [first])
  const shortEnd = first + 15 * 60000
  assert.deepEqual(dayHourTicks(first, shortEnd, 'Europe/Moscow'), [first, shortEnd])
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
