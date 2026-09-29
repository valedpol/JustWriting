import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadProfile, loadText, listTexts, saveText as writeText } from './textRepository.js'
import { loadUserDay } from './dayRepository.js'
import { dayBoundary } from '../domain/writingDay.js'
import { transaction, openDatabase } from './database.js'

const saveText = (ctx, previous, content) => writeText(ctx, previous, content, ctx.dayStartsAt + 1000)

const context = (profile, dayKey) => ({ userId: profile.userId, dayKey, timeZone: profile.timeZone, dayStartMinutes: 0, dayPolicyVersion: 1, dayStartsAt: dayBoundary(dayKey, 0, profile.timeZone), dayEndsAt: dayBoundary(new Date(Date.parse(`${dayKey}T00:00:00Z`) + 86400000).toISOString().slice(0, 10), 0, profile.timeZone) })

test('profile persists; opening and blank input do not create a text', async () => {
  const profile = await loadProfile()
  assert.deepEqual(await loadProfile(), profile)
  const ctx = context(profile, '2026-09-20')
  assert.equal(await loadText(ctx.userId, ctx.dayKey), null)
  assert.equal(await saveText(ctx, null, ' \n'), null)
  assert.equal(await loadUserDay(ctx.userId, ctx.dayKey), null)
  assert.equal(await loadText(ctx.userId, ctx.dayKey), null)
})

test('committed content restores from a fresh read; clearing preserves identity', async () => {
  const ctx = context(await loadProfile(), '2026-09-21')
  const created = await saveText(ctx, null, 'Первая строка\nВторая #осень')
  assert.deepEqual(await loadText(ctx.userId, ctx.dayKey), created)
  const changed = await saveText(ctx, created, 'Новая версия')
  assert.equal(changed.textId, created.textId)
  assert.equal(changed.userDayId, created.userDayId)
  const period = await loadUserDay(ctx.userId, ctx.dayKey)
  assert.equal(period.userDayId, created.userDayId)
  assert.equal(period.startsAt, ctx.dayStartsAt)
  assert.equal(period.endsAt, ctx.dayEndsAt)
  assert.equal(changed.revision, 2)
  const cleared = await saveText(ctx, changed, '')
  assert.equal(cleared.textId, created.textId)
  assert.equal((await loadText(ctx.userId, ctx.dayKey)).content, '')
  const db = await openDatabase()
  const freshConnection = await new Promise((resolve, reject) => {
    const request = indexedDB.open(db.name, db.version)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const restored = await new Promise((resolve) => {
    const request = freshConnection.transaction('texts').objectStore('texts').get(created.textId)
    request.onsuccess = () => resolve(request.result)
  })
  freshConnection.close()
  assert.equal(restored.revision, 3)
  assert.equal(restored.content, '')
})

test('stale or concurrent writes cannot silently replace committed text', async () => {
  const ctx = context(await loadProfile(), '2026-09-22')
  const original = await saveText(ctx, null, 'Начало')
  const writes = await Promise.allSettled([
    saveText(ctx, original, 'Версия A'), saveText(ctx, original, 'Версия B'),
  ])
  assert.equal(writes.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(writes.filter((r) => r.status === 'rejected').length, 1)
  assert.equal((await loadText(ctx.userId, ctx.dayKey)).revision, 2)
})

test('archive lists actual user records including cleared texts, newest first', async () => {
  const profile = await loadProfile()
  const records = await listTexts(profile.userId)
  assert.deepEqual(records.map((r) => r.dayKey), ['2026-09-22', '2026-09-21'])
  assert.equal(records[1].content, '')
  assert.deepEqual(await listTexts('another-user'), [])
})

test('aborted transaction rejects and does not leave a partial record', async () => {
  await assert.rejects(transaction(['texts'], 'readwrite', (tx, done, fail) => {
    tx.objectStore('texts').put({ textId: 'aborted', userId: 'test', dayKey: '2026-09-23' })
    done('must not resolve')
    fail(new Error('simulated storage failure'))
  }), /simulated storage failure/)
  assert.equal(await loadText('test', '2026-09-23'), null)
})
