import { test } from 'node:test'
import assert from 'node:assert/strict'
import { researchDayCell } from './researchDayCell.js'
import { researchData } from './research.js'

test('day cells depend on text existence and historical goal, not current count or selected state', () => {
  assert.deepEqual(researchDayCell(undefined), { hasText: false, reached: false, tooltip: 'Текста нет' })
  for (const [goal, reached, expected] of [[null, false, false], [null, true, false], [10, false, false], [10, true, true]]) {
    const entry = { words: 0, text: { content: '' }, day: { dailyWordGoal: goal, goalReached: reached } }
    assert.equal(researchDayCell(entry).hasText, true)
    assert.equal(researchDayCell(entry).reached, expected)
    assert.deepEqual(researchDayCell({ ...entry, selected: true }), researchDayCell({ ...entry, selected: false }))
  }
  assert.equal(researchDayCell({ words: 10000, day: { dailyWordGoal: 10, goalReached: false } }).reached, false)
})
test('tooltip uses Russian word declension, including zero and teens', () => {
  for (const [words, tooltip] of [[0, '0 слов'], [1, '1 слово'], [2, '2 слова'], [5, '5 слов'], [11, '11 слов'], [14, '14 слов'], [21, '21 слово'], [54, '54 слова'], [111, '111 слов']]) {
    assert.equal(researchDayCell({ words, day: {} }).tooltip, tooltip)
  }
})
test('cleared linked text still fills cell; empty day lookup and tooltip do not mutate snapshot', () => {
  const snapshot = { profile: { timeZone: 'UTC', dayStartMinutes: 0 }, samples: [],
    texts: [{ userId: 'u', userDayId: 'd', content: '' }],
    days: [{ userId: 'u', userDayId: 'd', dayKey: '2026-09-29', state: 'closed', dailyWordGoal: null }] }
  const before = structuredClone(snapshot)
  const data = researchData(snapshot, Date.parse('2026-09-30T12:00:00Z'))
  assert.equal(researchDayCell(data.entries.get('2026-09-29')).hasText, true)
  assert.equal(researchDayCell(data.entries.get('2026-09-30')).tooltip, 'Текста нет')
  assert.deepEqual(snapshot, before)
})

test('tooltip includes the day goal independently of achievement', () => {
  for (const goalReached of [false, true]) {
    for (const words of [0, 450, 550]) {
      const cell = researchDayCell({ words, day: { dailyWordGoal: 500, goalReached } })
      assert.equal(cell.tooltip, `${words} / 500 слов`)
      assert.equal(cell.reached, goalReached)
    }
    const noGoal = researchDayCell({ words: 550, day: { dailyWordGoal: null, goalReached } })
    assert.equal(noGoal.tooltip, '550 слов')
    assert.equal(noGoal.reached, false)
  }
})
