import test from 'node:test'
import assert from 'node:assert/strict'
import { filterArchivePeriod, archiveCalendarEntries } from './archivePeriod.js'

const records = [
  { textId: 'a', dayKey: '2025-10-04', content: '', dayStartsAt: 0 },
  { textId: 'b', dayKey: '2026-09-26', content: 'Один два', timeZone: 'UTC' },
  { textId: 'c', dayKey: '2026-10-04', content: 'Три', dayStartsAt: 0 },
]
test('archive period uses saved keys, supports all/year/month/day/empty and does not mutate records', () => {
  const before = structuredClone(records)
  assert.equal(filterArchivePeriod(records, null), records)
  for (const [period, ids] of [['2026', ['b', 'c']], ['2026-10', ['c']], ['2026-09-26', ['b']], ['2027', []]]) {
    assert.deepEqual(filterArchivePeriod(records, period).map(item => item.textId), ids)
  }
  assert.deepEqual(records, before)
  assert.equal(archiveCalendarEntries(records).size, 3)
  assert.equal(archiveCalendarEntries(records).get('2025-10-04').words, 0)
})
