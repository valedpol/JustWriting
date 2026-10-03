import { test } from 'node:test'
import assert from 'node:assert/strict'
import { researchMonth } from './researchMonth.js'

test('month indication uses record existence, including cleared text, and sums saved words', () => {
  const entries = new Map([
    ['2026-09-01', { words: 3000 }],
    ['2026-09-20', { words: 3086 }],
    ['2026-08-10', { words: 0 }],
    ['2025-09-01', { words: 999 }],
  ])
  const before = structuredClone(entries)
  assert.deepEqual(researchMonth(entries, '2026-09'), { hasText: true, words: 6086, tooltip: (6086).toLocaleString('ru-RU') + ' слов' })
  assert.deepEqual(researchMonth(entries, '2026-08'), { hasText: true, words: 0, tooltip: '0 слов' })
  assert.deepEqual(researchMonth(entries, '2026-02'), { hasText: false, words: 0, tooltip: null })
  assert.deepEqual(entries, before)
})

test('month tooltip uses word declension without goals or dates', () => {
  for (const [words, expected] of [[1, '1 слово'], [2, '2 слова'], [5, '5 слов'], [11, '11 слов'], [21, '21 слово']]) {
    assert.equal(researchMonth(new Map([['2026-09-01', { words }]]), '2026-09').tooltip, expected)
  }
})
