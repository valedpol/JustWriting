import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseDayPhrases, selectDayPhrase } from './dayPhrase.js'

const markdown = await readFile(new URL('../content/daily-phrases.md', import.meta.url), 'utf8')
const phrases = parseDayPhrases(markdown)

test('Markdown reads 18 line phrases in source order and ignores blank paragraph separators', () => {
  assert.equal(phrases.length, 18)
  assert.equal(phrases[0], 'Писать проще, когда вокруг тишина и достаточно времени, чтобы услышать себя')
  assert.equal(phrases.at(-2), 'Никто не обязан перечитывать. Даже ты')
  assert.equal(phrases.at(-1), 'Иногда полезно посмотреть на свой день глазами собеседника')
  assert.ok(phrases.every(phrase => !/^\d+\.\s/.test(phrase)), 'source contains phrases, not a numbered list')
  assert.deepEqual(parseDayPhrases(markdown.replaceAll('\n', '\r\n')), phrases)
  assert.deepEqual(parseDayPhrases(`\n\n${markdown.replaceAll('\n', '\n\n')}\n  \n`), phrases)
  assert.deepEqual(parseDayPhrases('  Первая фраза  \n\n  \n Вторая фраза\n'), ['Первая фраза', 'Вторая фраза'])
  assert.throws(() => parseDayPhrases('\n \n'), /Invalid/)
  assert.throws(() => parseDayPhrases('A\n\nA'), /Invalid/)
})

test('shuffle bag shows every phrase once in each cycle, survives reload and avoids cycle-boundary repeats', () => {
  let state, calls = 0, seed = 123456
  const random = () => { calls++; seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const shown = []
  for (let i = 0; i < phrases.length * 3; i++) {
    const dayKey = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
    state = selectDayPhrase(state, { dayKey, phrases, random })
    shown.push(state.selectedIndex)
    const before = calls
    assert.deepEqual(selectDayPhrase(structuredClone(state), { dayKey, phrases, random }), state)
    assert.equal(calls, before, 'same day must not consume randomness')
  }
  for (let i = 0; i < 3; i++) assert.equal(new Set(shown.slice(i * phrases.length, (i + 1) * phrases.length)).size, phrases.length)
  assert.notEqual(shown[phrases.length - 1], shown[phrases.length])
  assert.notEqual(shown[2 * phrases.length - 1], shown[2 * phrases.length])
  assert.notDeepEqual(shown.slice(0, phrases.length), shown.slice(phrases.length, 2 * phrases.length))
  assert.deepEqual(state.remaining, [])
})

test('refill explicitly prevents the old last phrase becoming the new first phrase', () => {
  const previous = { version: 1, dayKey: '2026-10-07', selectedIndex: 0, remaining: [], lastAuthEventId: null }
  const next = selectDayPhrase(previous, { dayKey: '2026-10-08', phrases, random: () => 1 - Number.EPSILON })
  assert.notEqual(next.selectedIndex, previous.selectedIndex)
  assert.equal(new Set([next.selectedIndex, ...next.remaining]).size, phrases.length)
  assert.deepEqual(previous.remaining, [], 'pure selection never mutates persisted input')
})

test('real auth events consume the same queue once, never refill early; stale day checks never move backwards', () => {
  const dayKey = '2026-10-07', random = () => 0.5
  const first = selectDayPhrase(null, { dayKey, phrases, random })
  const afterAuth = selectDayPhrase(first, { dayKey, authEventId: 'real-auth-1', phrases, random })
  assert.equal(afterAuth.selectedIndex, first.remaining[0])
  assert.deepEqual(afterAuth.remaining, first.remaining.slice(1))
  assert.equal(selectDayPhrase(afterAuth, { dayKey, authEventId: 'real-auth-1', phrases, random }), afterAuth)
  assert.equal(selectDayPhrase(afterAuth, { dayKey, phrases, random }), afterAuth)
  assert.equal(selectDayPhrase(afterAuth, { dayKey: '2026-10-06', phrases, random }), afterAuth)
  const next = selectDayPhrase(afterAuth, { dayKey, authEventId: 'real-auth-2', phrases, random })
  assert.equal(next.selectedIndex, afterAuth.remaining[0])
  assert.deepEqual(next.remaining, afterAuth.remaining.slice(1))
})
