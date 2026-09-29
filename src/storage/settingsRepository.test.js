import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transaction } from './database.js'
import { loadProfile, saveText, loadText, listTexts } from './textRepository.js'
import { resolveToday, loadUserDay } from './dayRepository.js'
import { saveProfileSetting } from './settingsRepository.js'
import { parseDayStart, formatDayStart, changeDayStart, calculateUserDay } from '../domain/writingDay.js'

const at = Date.parse
async function setup(minutes = 0, now = at('2026-09-25T23:40:00Z')) {
  const profile = { key: 'localProfile', userId: crypto.randomUUID(), displayName: 'Pol Valery', timeZone: 'UTC', dayStartMinutes: minutes, dayPolicyVersion: 1 }
  await transaction(['settings'], 'readwrite', (tx) => tx.objectStore('settings').put(profile))
  return { profile, today: await resolveToday(profile, now), now }
}

test('name is persisted and no text is created by a setting', async () => {
  const { profile } = await setup()
  await saveProfileSetting(profile.userId, 'displayName', '  Новое имя  ')
  assert.equal((await loadProfile()).displayName, 'Новое имя')
  await assert.rejects(saveProfileSetting(profile.userId, 'displayName', ' '), /пустым/)
  assert.equal((await loadProfile()).displayName, 'Новое имя')
  assert.deepEqual(await listTexts(profile.userId), [])
})

test('extend, reload, repeated changes, noon inclusive; invalid transaction leaves all data intact', async () => {
  const { profile, today, now } = await setup()
  const text = await saveText(today.context, null, 'Авторский текст', now)
  for (const minutes of [120, 300, 720]) {
    const result = await saveProfileSetting(profile.userId, 'dayStartMinutes', minutes, now)
    assert.equal(result.deferred, false)
  }
  const saved = await loadProfile()
  const day = await loadUserDay(profile.userId, today.context.dayKey)
  assert.equal(day.endsAt, at('2026-09-26T12:00:00Z'))
  const restored = await resolveToday(saved, now)
  assert.equal(restored.context.dayKey, today.context.dayKey)
  assert.equal(restored.context.dayEndsAt, day.endsAt)
  assert.equal(restored.record.textId, text.textId)
  assert.equal(restored.record.content, text.content)
  assert.equal(restored.record.revision, text.revision)
  const before = await loadProfile()
  await assert.rejects(saveProfileSetting(profile.userId, 'dayStartMinutes', 721, now), /12:00/)
  assert.deepEqual(await loadProfile(), before)
  assert.deepEqual(await loadUserDay(profile.userId, day.dayKey), day)
  assert.deepEqual(await loadText(profile.userId, day.dayKey), restored.record)
})

test('past boundary is deferred; next period does not overlap the saved previous day', async () => {
  const now = at('2026-09-26T01:40:00Z')
  const { profile, today } = await setup(120, now)
  await saveText(today.context, null, 'Вчера', now)
  const original = await loadUserDay(profile.userId, today.context.dayKey)
  const result = await saveProfileSetting(profile.userId, 'dayStartMinutes', 60, now)
  assert.equal(result.deferred, true)
  assert.equal(result.profile.dayStartMinutes, 60)
  assert.deepEqual(await loadUserDay(profile.userId, original.dayKey), original)
  const next = await resolveToday(await loadProfile(), original.endsAt)
  assert.equal(next.context.dayKey, '2026-09-26')
  assert.equal(next.context.dayStartsAt, original.endsAt)
  assert.equal(next.context.dayEndsAt, at('2026-09-27T01:00:00Z'))
  assert.equal(next.record, null)
  assert.equal(next.writable, true)
  assert.equal((await loadUserDay(profile.userId, original.dayKey)).state, 'closed')
})

test('clock rollback cannot modify settings or resurrect a closed period', async () => {
  const { profile, today, now } = await setup()
  await saveText(today.context, null, 'Текст', now)
  await resolveToday(profile, today.context.dayEndsAt)
  const before = await loadProfile()
  await assert.rejects(saveProfileSetting(profile.userId, 'dayStartMinutes', 120, now), /время/)
  assert.deepEqual(await loadProfile(), before)
  assert.equal((await loadUserDay(profile.userId, today.context.dayKey)).state, 'closed')
})

test('empty-day adjustment persists boundaries without creating archive entry', async () => {
  const { profile, today, now } = await setup()
  await saveProfileSetting(profile.userId, 'dayStartMinutes', 120, now)
  const next = await resolveToday(await loadProfile(), now)
  assert.equal(next.context.dayKey, today.context.dayKey)
  assert.equal(next.context.dayEndsAt, at('2026-09-26T02:00:00Z'))
  assert.deepEqual(await listTexts(profile.userId), [])
})

test('fixed calendar limit is independent of repeated changes and device timezone', () => {
  const day = calculateUserDay({ now: at('2026-09-25T10:00:00Z'), timeZone: 'Europe/Moscow' })
  assert.equal(changeDayStart(day, 721, at('2026-09-25T10:00:00Z')).reason, 'after-next-noon')
  assert.equal(changeDayStart(day, 720, at('2026-09-25T10:00:00Z')).day.endsAt, at('2026-09-26T09:00:00Z'))
  for (const value of ['', '24:00', '1:00', '12:60']) assert.throws(() => parseDayStart(value))
  assert.equal(parseDayStart('02:14'), 134)
  assert.equal(formatDayStart(134), '02:14')
})

test('word goal persists, clears to null, rejects invalid values without changing profile or text', async () => {
  const { profile, today, now } = await setup()
  const text = await saveText(today.context, null, 'Текст без изменений', now)
  const day = await loadUserDay(profile.userId, today.context.dayKey)
  await saveProfileSetting(profile.userId, 'dailyWordGoal', 750, now)
  assert.equal((await loadProfile()).dailyWordGoal, 750)
  const savedProfile = await loadProfile()
  for (const value of [0, -1, 1.5, NaN, Infinity, '750', undefined, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(saveProfileSetting(profile.userId, 'dailyWordGoal', value, now), /целое положительное/)
    assert.deepEqual(await loadProfile(), savedProfile)
  }
  await saveProfileSetting(profile.userId, 'dailyWordGoal', null, now)
  assert.equal((await loadProfile()).dailyWordGoal, null)
  assert.deepEqual(await loadUserDay(profile.userId, today.context.dayKey), { ...day, revision: day.revision + 2 })
  assert.deepEqual(await loadText(profile.userId, today.context.dayKey), text)
})

test('first goal achievement is atomic with text and remains historical after goal/content changes', async () => {
  const { profile, today, now } = await setup()
  await saveProfileSetting(profile.userId, 'dailyWordGoal', 2, now)
  let text = await saveText(today.context, null, 'Один', now)
  assert.equal((await loadUserDay(profile.userId, today.context.dayKey)).goalReached, false)
  text = await saveText(today.context, text, 'Один два', now + 1)
  const reached = await loadUserDay(profile.userId, today.context.dayKey)
  assert.equal(reached.goalReached, true)
  assert.equal(reached.goalReachedAt, now + 1)
  assert.equal(reached.goalAtReach, 2)
  await saveProfileSetting(profile.userId, 'dailyWordGoal', 100, now + 2)
  text = await saveText(today.context, text, '', now + 3)
  await saveProfileSetting(profile.userId, 'dailyWordGoal', null, now + 4)
  assert.deepEqual(await loadUserDay(profile.userId, today.context.dayKey), { ...reached, dailyWordGoal: null, revision: reached.revision + 2 })
})

test('lowering goal records achievement on existing text; disabling before reaching does not', async () => {
  const { profile, today, now } = await setup()
  await saveProfileSetting(profile.userId, 'dailyWordGoal', 10, now)
  let text = await saveText(today.context, null, 'Один два', now)
  await saveProfileSetting(profile.userId, 'dailyWordGoal', null, now + 1)
  text = await saveText(today.context, text, 'Один два три', now + 2)
  assert.equal((await loadUserDay(profile.userId, today.context.dayKey)).goalReached, false)
  await saveProfileSetting(profile.userId, 'dailyWordGoal', 3, now + 3)
  const day = await loadUserDay(profile.userId, today.context.dayKey)
  assert.equal(day.goalAtReach, 3)
  assert.equal(day.goalReachedAt, now + 3)
  assert.deepEqual(await loadText(profile.userId, today.context.dayKey), text)
})

test('setting goal never retroactively marks a closed day', async () => {
  const { profile, today, now } = await setup()
  await saveText(today.context, null, 'Один два', now)
  await resolveToday(profile, today.context.dayEndsAt)
  await saveProfileSetting(profile.userId, 'dailyWordGoal', 1, today.context.dayEndsAt)
  assert.equal((await loadUserDay(profile.userId, today.context.dayKey)).goalReached, false)
})

test('reported 508 → goal 510 → 511 scenario updates userDay revision for the new goal and achievement and survives polling', async () => {
  const now = at('2026-09-29T12:00:00Z')
  const { profile, today } = await setup(0, now)
  const words = (count) => Array(count).fill('слово').join(' ')
  let text = await saveText(today.context, null, words(508), now)
  await transaction(['userDays'], 'readwrite', (tx) => {
    const store = tx.objectStore('userDays')
    const read = store.index('userDay').get([profile.userId, today.context.dayKey])
    read.onsuccess = () => store.put({ ...read.result, revision: 4 })
  })
  await saveProfileSetting(profile.userId, 'dailyWordGoal', 510, now + 1)
  text = await saveText(today.context, text, words(511), now + 2)
  for (let i = 3; i < 6; i++) await resolveToday(await loadProfile(), now + i)
  const day = await loadUserDay(profile.userId, '2026-09-29')
  assert.equal(day.revision, 6)
  assert.equal(day.goalReached, true)
  assert.equal(day.goalAtReach, 510)
  assert.equal(day.goalReachedAt, now + 2)
  assert.equal((await loadText(profile.userId, today.context.dayKey)).content, text.content)
})

test('new days snapshot profile goal or null, with explicit history defaults', async () => {
  for (const goal of [null, 510]) {
    const { profile, today, now } = await setup()
    await saveProfileSetting(profile.userId, 'dailyWordGoal', goal, now)
    await saveText(today.context, null, 'Начало', now + 1)
    const day = await loadUserDay(profile.userId, today.context.dayKey)
    assert.equal(day.dailyWordGoal, goal)
    assert.equal(day.goalReached, false)
    assert.equal(day.goalReachedAt, null)
    assert.equal(day.goalAtReach, null)
    await resolveToday(await loadProfile(), now + 2)
    assert.deepEqual(await loadUserDay(profile.userId, today.context.dayKey), day)
  }
})

test('goal updates before and after achievement track latest goal while preserving first history', async () => {
  const { profile, today, now } = await setup()
  await saveProfileSetting(profile.userId, 'dailyWordGoal', 10, now)
  await saveText(today.context, null, 'Один два три', now)
  let previous = await loadUserDay(profile.userId, today.context.dayKey)
  for (const [i, goal] of [5, 3, 100, 1, null].entries()) {
    await saveProfileSetting(profile.userId, 'dailyWordGoal', goal, now + i + 1)
    const day = await loadUserDay(profile.userId, today.context.dayKey)
    assert.equal(day.dailyWordGoal, goal)
    assert.equal(day.revision, previous.revision + 1)
    assert.equal(day.goalReached, i >= 1)
    assert.equal(day.goalReachedAt, i >= 1 ? now + 2 : null)
    assert.equal(day.goalAtReach, i >= 1 ? 3 : null)
    await resolveToday(await loadProfile(), now + i + 1)
    assert.deepEqual(await loadUserDay(profile.userId, today.context.dayKey), day)
    previous = day
  }
})
