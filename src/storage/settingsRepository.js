import { initialDayGoal, updateDayGoal } from '../domain/wordGoal.js'
import { transaction } from './database.js'
import { calculateUserDay, changeDayStart } from '../domain/writingDay.js'

export function saveProfileSetting(userId, field, value, now = Date.now()) {
  if (!['displayName', 'dayStartMinutes', 'dailyWordGoal'].includes(field)) return Promise.reject(new Error('Настройка пока недоступна.'))
  if (field === 'displayName' && (typeof value !== 'string' || !value.trim())) return Promise.reject(new Error('Имя не должно быть пустым.'))
  if (field === 'dailyWordGoal' && value !== null && (!Number.isSafeInteger(value) || value <= 0)) return Promise.reject(new Error('Введите целое положительное число или оставьте поле пустым.'))
  return transaction(['settings', 'texts', 'userDays'], 'readwrite', (tx, done, fail) => {
    const settings = tx.objectStore('settings')
    const read = settings.get('localProfile')
    read.onsuccess = () => {
      const profile = read.result
      if (!profile || profile.userId !== userId) { fail(new Error('Профиль изменился. Перезагрузите страницу.')); return }
      if (field === 'displayName' || field === 'dailyWordGoal') {
        const next = { ...profile, [field]: field === 'displayName' ? value.trim() : value }
        settings.put(next)
        if (field === 'dailyWordGoal') {
          const days = tx.objectStore('userDays')
          const lookup = days.index('userId').getAll(userId)
          lookup.onsuccess = () => {
            const day = lookup.result.find((d) => d.state === 'open' && d.startsAt <= now && now < d.endsAt)
            if (!day) return
            const textRead = tx.objectStore('texts').index('userDay').get([userId, day.dayKey])
            textRead.onsuccess = () => {
              const updated = updateDayGoal(day, value, textRead.result?.content ?? '', now)
              if (updated !== day) days.put(updated)
            }
          }
        }
        done({ profile: next, deferred: false }); return
      }
      const days = tx.objectStore('userDays')
      const lookup = days.index('userId').getAll(userId)
      lookup.onsuccess = () => {
        try {
          if (now < (Math.max(profile.lastDaySettingAt ?? 0, profile.lastObservedAt ?? 0))) throw new Error('Системное время переведено назад. Изменение начала дня отклонено.')
          const periods = lookup.result
          if (periods.some((d) => d.startsAt > now || (d.closedAt != null && d.closedAt > now))) throw new Error('Системное время переведено назад. Изменение начала дня отклонено.')
          const active = periods.find((d) => d.state === 'open' && d.startsAt <= now && now < d.endsAt)
          const calculated = calculateUserDay({ ...profile, now })
          const existing = periods.find((d) => d.dayKey === calculated.dayKey)
          const day = active || existing || { ...calculated, ...initialDayGoal(profile.dailyWordGoal), userId, userDayId: crypto.randomUUID(), state: 'open', revision: 1, closedAt: null, graceUntil: null, graceSessionId: null }
          const result = changeDayStart(day, value, now)
          const deferred = result.reason === 'boundary-passed' || result.reason === 'day-ended'
          if (!result.ok && !deferred) throw new Error(result.reason === 'after-next-noon' ? 'Окончание дня не может быть позже 12:00 следующей даты.' : 'Нельзя изменить границу дня: проверьте системное время.')
          // A closed date reached by clock rollback must not be used to alter policy.
          if (day.state === 'closed' && now < day.endsAt) throw new Error('Этот день уже закрыт. Проверьте системное время.')
          const next = { ...profile, dayStartMinutes: value, dayPolicyVersion: profile.dayPolicyVersion + 1, lastDaySettingAt: now }
          settings.put(next)
          const updated = result.ok ? { ...result.day, revision: day.revision + 1 } : day
          if (updated.state === 'open') days.put(updated)
          const textRead = tx.objectStore('texts').index('userDay').get([userId, day.dayKey])
          textRead.onsuccess = () => {
            if (result.ok && textRead.result) {
              tx.objectStore('texts').put({ ...textRead.result, dayStartMinutes: updated.dayStartMinutes, dayPolicyVersion: updated.dayPolicyVersion, dayEndsAt: updated.endsAt })
            }
            done({ profile: next, deferred })
          }
        } catch (error) { fail(error) }
      }
    }
  })
}
