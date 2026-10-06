import { test } from 'node:test'
import assert from 'node:assert/strict'
import { researchData, shiftDate } from './research.js'

const now = Date.parse('2027-01-01T12:00:00Z')
const profile = { userId: 'u', timeZone: 'UTC', dayStartMinutes: 0 }
function snapshot(keys) {
  return { profile, days: keys.map((key) => ({ userId: 'u', userDayId: key, dayKey: key, state: 'closed' })),
    texts: keys.map((key) => ({ userId: 'u', userDayId: key, dayKey: 'ignored', content: 'Один два' })), samples: [] }
}
test('text existence counts even cleared content; day-only records do not; words come from contents', () => {
  const data = snapshot(['2026-12-30', '2026-12-31'])
  data.texts[0].content = ''
  data.days.push({ userId: 'u', userDayId: 'empty', dayKey: '2026-12-29' })
  const result = researchData(data, now)
  assert.equal(result.writingDays, 2)
  assert.equal(result.totalWords, 2)
  assert.equal(result.entries.get('2026-12-30').words, 0)
  assert.equal(result.entries.has('2026-12-29'), false)
})
test('calendar adjacency crosses months, leap date and year', () => {
  assert.equal(shiftDate('2027-01-01', -1), '2026-12-31')
  assert.equal(shiftDate('2026-10-01', -1), '2026-09-30')
  assert.equal(shiftDate('2024-03-01', -1), '2024-02-29')
})
test('yesterday streak remains current until empty current day finishes', () => {
  const data = snapshot(['2026-12-30', '2026-12-31'])
  assert.equal(researchData(data, now).streak, 2)
  assert.equal(researchData(data, Date.parse('2027-01-02T00:00:00Z')).streak, 0)
})
test('saved extended open period takes priority; grace does not add a calendar day', () => {
  const data = snapshot(['2026-12-30', '2026-12-31'])
  Object.assign(data.days[1], { state: 'open', startsAt: now - 86400000, endsAt: now + 1 })
  assert.equal(researchData(data, now).currentKey, '2026-12-31')
  assert.equal(researchData(data, now).streak, 2)
  Object.assign(data.days[1], { state: 'grace', endsAt: now - 1, graceUntil: now + 3600000 })
  assert.equal(researchData(data, now).currentKey, '2027-01-01')
  assert.equal(researchData(data, now).streak, 2)
})
test('samples are sorted without removing equal counts or reconstructing missing points', () => {
  const data = snapshot(['2026-12-31'])
  data.samples = [30, 10, 20].map((timestamp, i) => ({ userId: 'u', userDayId: '2026-12-31', timestamp, wordCount: i === 0 ? 1 : 2 }))
  const result = researchData(data, now)
  assert.deepEqual(result.samples.map((s) => [s.timestamp, s.wordCount]), [[10, 2], [20, 2], [30, 1]])
  assert.deepEqual(researchData(snapshot(['2026-12-31']), now).samples, [])
})


test('semantic totals count distinct saved values across texts, separately by kind', () => {
  const data = snapshot(['2026-12-30', '2026-12-31'])
  data.texts[0].semanticMarkup = [
    { id: 'a', kind: 'tag', value: 'Мысли' }, { id: 'b', kind: 'tag', value: 'Мысли' },
    { kind: 'title', value: 'Утро' }, { kind: 'title', value: 'Мысли' },
  ]
  data.texts[1].semanticMarkup = [
    { id: 'c', kind: 'tag', value: 'Мысли', valueId: 'different-id' },
    { kind: 'tag', value: 'Работа', source: 'slash', range: null },
    { kind: 'title', value: 'Утро' }, { kind: 'title', value: 'Вечер' },
    { kind: 'tag', value: '' }, { kind: 'title' }, { kind: 'other', value: 'Ignore' },
  ]
  data.texts.push({ userId: 'other', userDayId: '2026-12-31', semanticMarkup: [{ kind: 'tag', value: 'Foreign' }] })
  data.texts.push({ userId: 'u', userDayId: 'missing', semanticMarkup: [{ kind: 'title', value: 'Orphan' }] })
  const result = researchData(data, now)
  assert.equal(result.tagCount, 2)
  assert.equal(result.titleCount, 3)
  assert.equal(result.writingDays, 2)
  assert.equal(result.totalWords, 4)
})

test('legacy texts without semantic markup have zero semantic totals', () => {
  const data = snapshot(['2026-12-31'])
  assert.equal(researchData(data, now).tagCount, 0)
  assert.equal(researchData(data, now).titleCount, 0)
})
