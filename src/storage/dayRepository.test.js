import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveToday, loadUserDay } from './dayRepository.js'
import { saveText, loadText, listTexts } from './textRepository.js'
const at = Date.parse
const profile = () => ({ userId: crypto.randomUUID(), timeZone: 'Europe/Moscow', dayStartMinutes: 0, dayPolicyVersion: 1 })

test('boundary closes saved day, leaves new day empty, rejects every closed-content write', async () => {
  const p = profile()
  const before = at('2026-09-28T20:59:59Z')
  const old = await resolveToday(p, before)
  const text = await saveText(old.context, null, 'Сохранённый текст', before)
  const next = await resolveToday(p, before + 1000)
  assert.equal(next.context.dayKey, '2026-09-29')
  assert.equal(next.record, null)
  assert.equal(await loadUserDay(p.userId, next.context.dayKey), null)
  const closed = await loadUserDay(p.userId, old.context.dayKey)
  assert.equal(closed.state, 'closed')
  assert.equal(closed.closedAt, old.context.dayEndsAt)
  await assert.rejects(saveText(old.context, text, 'не должно записаться', before + 1000), /закрыт/)
  await assert.rejects(saveText(old.context, text, 'даже с прошлым временем', before), /закрыт/)
  assert.deepEqual(await loadText(p.userId, old.context.dayKey), text)
  assert.equal((await listTexts(p.userId)).length, 1)
})

test('repository refuses expired content without a timer; restart/sleep never reopen it', async () => {
  const p = profile()
  const old = await resolveToday(p, at('2026-09-28T12:00:00Z'))
  const text = await saveText(old.context, null, 'Вчера', old.context.dayStartsAt + 1000)
  await assert.rejects(saveText(old.context, text, 'Поздняя правка', old.context.dayEndsAt), /закрыт/)
  const next = await resolveToday(p, at('2026-10-02T12:00:00Z'))
  assert.equal(next.context.dayKey, '2026-10-02')
  assert.equal(next.record, null)
  assert.equal((await loadUserDay(p.userId, old.context.dayKey)).state, 'closed')
  const rolledBack = await resolveToday(p, old.context.dayStartsAt + 1000)
  assert.equal(rolledBack.writable, false)
  assert.equal(rolledBack.record.content, 'Вчера')
})

test('existing new-day text is loaded without reset or new revision', async () => {
  const p = profile()
  const now = at('2026-09-29T12:00:00Z')
  const today = await resolveToday(p, now)
  const text = await saveText(today.context, null, 'Уже написано сегодня', now)
  const restarted = await resolveToday(p, now + 1000)
  assert.deepEqual(restarted.record, text)
  assert.equal(restarted.writable, true)
})

test('saved period boundaries prevail over changed profile settings', async () => {
  const p = profile()
  const now = at('2026-09-28T12:00:00Z')
  const today = await resolveToday(p, now)
  await saveText(today.context, null, 'Текст', now)
  const resolved = await resolveToday({ ...p, timeZone: 'Pacific/Honolulu', dayStartMinutes: 600 }, now)
  assert.deepEqual(resolved.context, today.context)
})
