import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sampleWordCount, SAMPLE_INTERVAL as interval } from './wordCountRepository.js'
import { resolveToday, loadUserDay, endWritingSession } from './dayRepository.js'
import { saveText, loadText } from './textRepository.js'
import { transaction } from './database.js'

const now = Date.parse('2026-09-30T12:00:00Z')
async function setup(at = now) {
  const profile = { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 }
  const today = await resolveToday(profile, at)
  const text = await saveText(today.context, null, 'Один два', at, 'session')
  return { profile, today, text }
}
const points = (id) => transaction(['wordCountSamples'], 'readonly', (tx, done) => {
  const read = tx.objectStore('wordCountSamples').index('userDayTime').getAll(IDBKeyRange.bound([id, -Infinity], [id, Infinity]))
  read.onsuccess = () => done(read.result)
})

test('first observation, unchanged points, revisions, deletion and zero; source records unchanged by sampling', async () => {
  const { profile, today, text } = await setup()
  const day = await loadUserDay(profile.userId, today.context.dayKey)
  const first = await sampleWordCount(profile.userId, text.userDayId, 'session', now)
  assert.equal(first.wordCount, 2)
  assert.equal(first.textRevision, text.revision)
  assert.equal(first.dayKey, text.dayKey)
  assert.deepEqual(await loadUserDay(profile.userId, text.dayKey), day)
  assert.deepEqual(await loadText(profile.userId, text.dayKey), text)
  assert.equal(await sampleWordCount(profile.userId, text.userDayId, 'session', now + interval - 1), null)
  const second = await sampleWordCount(profile.userId, text.userDayId, 'session', now + interval)
  assert.equal(second.wordCount, 2)
  const edited = await saveText(today.context, text, 'Три четыре', now + interval + 1, 'session')
  const third = await sampleWordCount(profile.userId, text.userDayId, 'session', now + interval * 2)
  assert.equal(third.wordCount, 2)
  assert.equal(third.textRevision, edited.revision)
  const reduced = await saveText(today.context, edited, 'Три', now + interval * 2 + 1, 'session')
  assert.equal((await sampleWordCount(profile.userId, text.userDayId, 'session', now + interval * 3)).wordCount, 1)
  await saveText(today.context, reduced, '', now + interval * 3 + 1, 'session')
  assert.equal((await sampleWordCount(profile.userId, text.userDayId, 'session', now + interval * 4)).wordCount, 0)
})

test('concurrent tabs and reload deduplicate; sleep gives one actual observation, rollback adds none', async () => {
  const { profile, text } = await setup()
  const args = [profile.userId, text.userDayId]
  const concurrent = await Promise.all([sampleWordCount(...args, 'session', now), sampleWordCount(...args, 'tab2', now)])
  assert.equal(concurrent.filter(Boolean).length, 1)
  assert.equal(await sampleWordCount(...args, 'reloaded', now + 1000), null)
  const resumed = await sampleWordCount(...args, 'reloaded', now + 20 * 60000)
  assert.equal(resumed.timestamp, now + 20 * 60000)
  assert.equal((await points(text.userDayId)).length, 2)
  assert.equal(await sampleWordCount(...args, 'session', now), null)
})

test('grace continues same series only for owner; expired/closed days reject observations', async () => {
  const before = Date.parse('2026-09-30T23:59:00Z')
  const { profile, today, text } = await setup(before)
  await sampleWordCount(profile.userId, text.userDayId, 'session', before)
  const grace = await resolveToday(profile, before + interval, 'session')
  assert.equal(await sampleWordCount(profile.userId, text.userDayId, 'foreign', before + interval), null)
  const sample = await sampleWordCount(profile.userId, text.userDayId, 'session', before + interval)
  assert.equal(sample.userDayId, text.userDayId)
  assert.equal(sample.dayKey, text.dayKey)
  assert.equal(await sampleWordCount(profile.userId, text.userDayId, 'session', grace.context.graceUntil), null)
  await endWritingSession(profile.userId, 'session', before + interval + 1)
  assert.equal(await sampleWordCount(profile.userId, text.userDayId, 'session', before + interval * 2), null)
  assert.equal((await loadUserDay(profile.userId, today.context.dayKey)).state, 'closed')
})

test('opening, missing text, missing session and other users produce no points', async () => {
  const { profile, text } = await setup()
  assert.deepEqual(await points(text.userDayId), [])
  assert.equal(await sampleWordCount(profile.userId, text.userDayId, null, now), null)
  assert.equal(await sampleWordCount('other', text.userDayId, 'session', now), null)
  assert.equal(await sampleWordCount(profile.userId, 'missing', 'session', now), null)
  assert.deepEqual(await points(text.userDayId), [])
})
