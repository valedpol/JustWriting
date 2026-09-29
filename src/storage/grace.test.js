import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveToday, loadUserDay, endWritingSession } from './dayRepository.js'
import { saveText, loadText } from './textRepository.js'
import { advanceDay, canWriteDay, GRACE_DURATION } from '../domain/grace.js'

const now = Date.parse('2026-09-30T23:59:00Z')
async function setup(id = 'owner') {
  const profile = { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 }
  const today = await resolveToday(profile, now)
  const text = await saveText(today.context, null, 'До границы', now, id)
  return { profile, today, text, end: today.context.dayEndsAt }
}

test('continuous session gets fixed grace, including hidden-tab return and a foreign boundary check', async () => {
  const { profile, today, text, end } = await setup()
  const stranger = await resolveToday(profile, end)
  assert.equal(stranger.record, null)
  const resumed = await resolveToday(profile, end + 30 * 60000, 'owner')
  assert.equal(resumed.context.dayKey, today.context.dayKey)
  assert.equal(resumed.context.graceUntil, end + GRACE_DURATION)
  assert.equal(resumed.writable, true)
  const updated = await saveText(resumed.context, text, 'До границы и после', end + 30 * 60000, 'owner')
  assert.equal(updated.dayKey, today.context.dayKey)
  await assert.rejects(saveText(resumed.context, updated, 'Чужое', end + 31 * 60000, 'stranger'), /закрыт/)
  assert.equal((await loadText(profile.userId, today.context.dayKey)).content, updated.content)
})

test('no input session grants no grace; reload cannot join another session', async () => {
  const noSession = await setup(null)
  await resolveToday(noSession.profile, noSession.end)
  assert.equal((await loadUserDay(noSession.profile.userId, noSession.today.context.dayKey)).state, 'closed')
  const active = await setup()
  const restart = await resolveToday(active.profile, active.end + 1)
  assert.notEqual(restart.context.dayKey, active.today.context.dayKey)
  assert.equal(restart.record, null)
})

test('exact deadline closes day permanently; new day can save without copying old content', async () => {
  const { profile, today, text, end } = await setup()
  await resolveToday(profile, end, 'owner')
  const deadline = end + GRACE_DURATION
  const last = await saveText(today.context, text, 'Последняя правка', deadline - 1, 'owner')
  const next = await resolveToday(profile, deadline, 'owner')
  assert.notEqual(next.context.dayKey, today.context.dayKey)
  await assert.rejects(saveText(today.context, last, 'Поздно', deadline, 'owner'), /закрыт/)
  await assert.rejects(saveText(today.context, last, 'Откат часов', deadline - 1, 'owner'), /закрыт/)
  const newText = await saveText(next.context, null, 'Новый ввод', deadline, 'new-owner')
  assert.equal(newText.content, 'Новый ввод')
  assert.equal((await loadText(profile.userId, today.context.dayKey)).content, last.content)
})

test('explicit exit ends grace, while exiting before boundary merely removes eligibility', async () => {
  for (const after of [false, true]) {
    const { profile, today, end } = await setup()
    if (after) await resolveToday(profile, end, 'owner')
    await endWritingSession(profile.userId, 'owner', after ? end + 1 : end - 1)
    const next = await resolveToday(profile, end + 2, 'owner')
    assert.notEqual(next.context.dayKey, today.context.dayKey)
    assert.equal((await loadUserDay(profile.userId, today.context.dayKey)).state, 'closed')
  }
})

test('delayed first check never extends grace and closed day cannot reopen', () => {
  const day = { state: 'open', startsAt: 0, endsAt: 100, revision: 1, writingSessionId: 'owner' }
  const grace = advanceDay(day, 101)
  assert.equal(grace.graceUntil, 100 + GRACE_DURATION)
  assert.equal(canWriteDay(grace, 101, 'owner'), true)
  assert.equal(canWriteDay(grace, 101, 'other'), false)
  const closed = advanceDay(day, 100 + GRACE_DURATION)
  assert.equal(closed.state, 'closed')
  assert.equal(advanceDay(closed, 50), closed)
})
