import { advanceDay, canWriteDay } from '../domain/grace.js'
import { updateDayGoal } from '../domain/wordGoal.js'
import { transaction } from './database.js'
import { userDayFromText } from '../domain/userDay.js'

export function loadProfile() {
  return transaction(['settings'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('settings')
    const request = store.get('localProfile')
    request.onsuccess = () => {
      const profile = request.result || {
        key: 'localProfile', userId: `local:${crypto.randomUUID()}`,
        deviceId: crypto.randomUUID(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        displayName: 'Pol Valery', dayStartMinutes: 0, dayPolicyVersion: 1, createdAt: Date.now(),
      }
      const missingName = !profile.displayName
      if (missingName) profile.displayName = 'Pol Valery'
      if (!request.result) store.add(profile)
      else if (missingName) store.put(profile)
      done(profile)
    }
  })
}

export function loadText(userId, dayKey) {
  return transaction(['texts'], 'readonly', (tx, done) => {
    const request = tx.objectStore('texts').index('userDay').get([userId, dayKey])
    request.onsuccess = () => done(request.result || null)
  })
}

export function listTexts(userId) {
  return transaction(['texts'], 'readonly', (tx, done) => {
    const request = tx.objectStore('texts').index('userId').getAll(userId)
    request.onsuccess = () => done(request.result.sort((a, b) => b.dayKey.localeCompare(a.dayKey)))
  })
}

export function saveText(context, previous, content, acceptedAt = Date.now(), sessionId = null) {
  return transaction(['settings', 'texts', 'userDays'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('texts')
    const request = store.index('userDay').get([context.userId, context.dayKey])
    request.onsuccess = () => {
      const current = request.result || null
      if ((current?.revision ?? 0) !== (previous?.revision ?? 0) || current?.textId !== previous?.textId) {
        fail(new Error('Текст изменён в другой вкладке. Эта версия не перезаписана.'))
        return
      }
      if (!current && !content.trim()) { done(null); return }
      const days = tx.objectStore('userDays')
      const lookup = days.index('userDay').get([context.userId, context.dayKey])
      lookup.onsuccess = () => {
        const originalDay = lookup.result
        const day = originalDay ? advanceDay(originalDay, acceptedAt) : null
        if (day && day !== originalDay) days.put(day)
        const startsAt = day?.startsAt ?? context.dayStartsAt
        const endsAt = day?.endsAt ?? context.dayEndsAt
        if (!canWriteDay(day || { state: 'open', startsAt, endsAt }, acceptedAt, sessionId)) {
          done({ rejected: true, reason: 'day-closed' })
          return
        }
        const now = Date.now()
        const record = {
          ...(current || context), textId: current?.textId || crypto.randomUUID(), content,
          revision: (current?.revision || 0) + 1, serverRevision: null,
          createdAt: current?.createdAt || now, updatedAt: now,
        }
        let savedDay = day
        if (day) record.userDayId = day.userDayId
        else {
          try {
            const created = userDayFromText(record, acceptedAt)
            days.add(created)
            savedDay = created
            record.userDayId = created.userDayId
          } catch (error) { fail(error); return }
        }
        if (sessionId && savedDay.state === 'open' && savedDay.writingSessionId !== sessionId) {
          savedDay = { ...savedDay, writingSessionId: sessionId, revision: savedDay.revision + 1 }
          days.put(savedDay)
        }
        store.put(record)
        const profileRead = tx.objectStore('settings').get('localProfile')
        profileRead.onsuccess = () => {
          const profile = profileRead.result
          if (profile?.userId === context.userId) {
            const updated = updateDayGoal(savedDay, day ? savedDay.dailyWordGoal : (profile.dailyWordGoal ?? null), content, acceptedAt)
            if (updated !== savedDay) days.put(updated)
          }
          done(record)
        }
      }
    }
  }).then((result) => {
    if (result?.rejected) throw new Error('Пользовательский день закрыт. Изменение текста запрещено.')
    return result
  })
}
