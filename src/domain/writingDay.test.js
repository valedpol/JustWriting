import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateUserDay, changeDayStart, dayBoundary, isDayEnded, latestAllowedEnd } from './writingDay.js'
const at = (s) => Date.parse(s)
const day = (now, dayStartMinutes = 0, timeZone = 'Europe/Moscow') => calculateUserDay({ now: at(now), dayStartMinutes, timeZone })

test('local day uses explicit timezone, including midnight boundary', () => {
  assert.equal(day('2026-09-25T20:59:59Z').dayKey, '2026-09-25')
  assert.equal(day('2026-09-25T21:00:00Z').dayKey, '2026-09-26')
  assert.equal(day('2026-09-25T21:00:00Z', 120).dayKey, '2026-09-25')
  assert.equal(day('2026-09-25T23:00:00Z', 120).dayKey, '2026-09-26')
})

test('23:40 change from midnight to 02:00 extends existing day, preserving identity', () => {
  const original = Object.freeze({ ...day('2026-09-25T20:40:00Z'), state: 'open' })
  const result = changeDayStart(original, 120, at('2026-09-25T20:40:00Z'))
  assert.equal(result.day.endsAt, at('2026-09-25T23:00:00Z'))
  assert.equal(result.day.dayKey, original.dayKey)
  assert.equal(result.day.startsAt, original.startsAt)
  assert.equal(original.dayStartMinutes, 0)
})

test('repeated changes stop at noon of the date after the fixed dayKey', () => {
  let current = day('2026-09-25T20:40:00Z')
  for (const minute of [120, 300, 720]) {
    const result = changeDayStart(current, minute, at('2026-09-25T20:40:00Z'))
    assert.equal(result.ok, true)
    current = result.day
  }
  assert.equal(current.endsAt, latestAllowedEnd(current))
  assert.equal(current.endsAt, at('2026-09-26T09:00:00Z'))
  assert.equal(changeDayStart(current, 721, at('2026-09-26T08:00:00Z')).reason, 'after-next-noon')
})

test('future end can move earlier, a passed boundary cannot revive a day', () => {
  const current = day('2026-09-25T20:40:00Z', 120)
  assert.equal(changeDayStart(current, 60, at('2026-09-25T20:40:00Z')).day.endsAt, at('2026-09-25T22:00:00Z'))
  assert.equal(changeDayStart(current, 60, at('2026-09-25T22:40:00Z')).reason, 'boundary-passed')
  assert.equal(changeDayStart(current, 180, current.endsAt).reason, 'day-ended')
  for (const state of ['closed', 'grace']) {
    assert.equal(changeDayStart({ ...current, state }, 180, current.startsAt + 1).reason, 'day-ended')
  }
})

test('year and leap-month transitions', () => {
  assert.equal(day('2026-12-31T22:00:00Z').dayKey, '2027-01-01')
  assert.equal(dayBoundary('2024-02-29', 0, 'UTC'), at('2024-02-29T00:00:00Z'))
  assert.throws(() => dayBoundary('2026-02-29', 0, 'UTC'), RangeError)
})

test('DST days last 23 or 25 hours; gap resolves forward, overlap uses first occurrence', () => {
  const spring = day('2026-03-29T10:00:00Z', 0, 'Europe/Berlin')
  const autumn = day('2026-10-25T10:00:00Z', 0, 'Europe/Berlin')
  assert.equal(spring.endsAt - spring.startsAt, 23 * 3600000)
  assert.equal(autumn.endsAt - autumn.startsAt, 25 * 3600000)
  assert.equal(dayBoundary('2026-03-29', 150, 'Europe/Berlin'), at('2026-03-29T01:00:00Z'))
  assert.equal(dayBoundary('2026-10-25', 150, 'Europe/Berlin'), at('2026-10-25T00:30:00Z'))
})

test('closed state survives clock rollback; exact end is no longer open', () => {
  const current = day('2026-09-25T12:00:00Z')
  assert.equal(isDayEnded(current, current.endsAt - 1), false)
  assert.equal(isDayEnded(current, current.endsAt), true)
  assert.equal(isDayEnded({ ...current, state: 'closed' }, current.startsAt), true)
})

test('reject invalid policy inputs', () => {
  for (const value of [-1, 1440, 1.5, NaN]) assert.throws(() => dayBoundary('2026-09-25', value, 'UTC'), RangeError)
  assert.throws(() => dayBoundary('2026-09-25', 0, 'Invalid/Zone'), RangeError)
  assert.throws(() => calculateUserDay({ now: NaN, timeZone: 'UTC' }), RangeError)
})
