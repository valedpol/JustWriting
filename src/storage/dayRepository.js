import { advanceDay, canWriteDay } from '../domain/grace.js'
import { calculateUserDay } from '../domain/writingDay.js'
import { transaction } from './database.js'

export function listUserDays(userId) {
  return transaction(['userDays'], 'readonly', (tx, done) => {
    const request = tx.objectStore('userDays').index('userId').getAll(userId)
    request.onsuccess = () => done(request.result)
  })
}

export function loadUserDay(userId, dayKey) {
  return transaction(['userDays'], 'readonly', (tx, done) => {
    const request = tx.objectStore('userDays').index('userDay').get([userId, dayKey])
    request.onsuccess = () => done(request.result || null)
  })
}

export function resolveToday(profile, now = Date.now(), sessionId = null) {
  const calculated = calculateUserDay({ now, ...profile })
  return transaction(['settings', 'userDays', 'texts'], 'readwrite', (tx, done) => {
    const settings = tx.objectStore('settings')
    const profileRead = settings.get('localProfile')
    profileRead.onsuccess = () => {
      const stored = profileRead.result
      if (stored?.userId === profile.userId && now > (stored.lastObservedAt ?? 0)) {
        settings.put({ ...stored, lastObservedAt: now })
      }
    }
    const store = tx.objectStore('userDays')
    const request = store.index('userId').getAll(profile.userId)
    request.onsuccess = () => {
      const days = request.result
      for (let index = 0; index < days.length; index++) {
        const updated = advanceDay(days[index], now)
        if (updated !== days[index]) { days[index] = updated; store.put(updated) }
      }
      const ownedGrace = days.find((d) => d.state === 'grace' && canWriteDay(d, now, sessionId))
      const active = days.find((d) => d.state === 'open' && d.startsAt <= now && now < d.endsAt)
      const day = ownedGrace || active || days.find((d) => d.dayKey === calculated.dayKey) || calculated
      // A deferred earlier start must not overlap the preceding saved period.
      if (!day.userDayId) {
        const prior = days.filter((d) => d.state === 'closed' && d.endsAt <= now && d.dayKey < day.dayKey)
          .sort((a, b) => b.endsAt - a.endsAt)[0]
        if (prior && prior.endsAt > day.startsAt) day.startsAt = prior.endsAt
      }
      const context = {
        userId: profile.userId, dayKey: day.dayKey, timeZone: day.timeZone,
        dayStartMinutes: day.dayStartMinutes, dayPolicyVersion: day.dayPolicyVersion,
        dayStartsAt: day.startsAt, dayEndsAt: day.endsAt,
        graceUntil: day.state === 'grace' ? day.graceUntil : null,
      }
      const read = tx.objectStore('texts').index('userDay').get([profile.userId, day.dayKey])
      read.onsuccess = () => done({ context, record: read.result || null, writable: canWriteDay({ state: 'open', ...day }, now, sessionId) })
    }
  })
}


export function endWritingSession(userId, sessionId, now = Date.now()) {
  return transaction(['userDays'], 'readwrite', (tx) => {
    const store = tx.objectStore('userDays')
    const read = store.index('userId').getAll(userId)
    read.onsuccess = () => {
      for (const day of read.result) {
        if (day.state === 'closed' || day.writingSessionId !== sessionId) continue
        const ended = now >= day.endsAt
        store.put({ ...day, writingSessionId: null,
          ...(ended ? { state: 'closed', closedAt: Math.min(now, day.graceUntil ?? day.endsAt) } : {}),
          revision: day.revision + 1 })
      }
    }
  })
}
