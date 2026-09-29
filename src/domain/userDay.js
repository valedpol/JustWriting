import { initialDayGoal } from './wordGoal.js'
import { dayBoundary, localDayKey } from './writingDay.js'

export const USER_DAY_STATES = Object.freeze(['open', 'grace', 'closed'])

// Preserve recorded boundaries; never infer missing historical dates or times.
export function userDayFromText(text, now, userDayId = crypto.randomUUID()) {
  if (!text.textId || !text.userId || !Number.isFinite(now) ||
      !Number.isInteger(text.dayPolicyVersion) || text.dayPolicyVersion < 1 ||
      !Number.isFinite(text.dayStartsAt) || !Number.isFinite(text.dayEndsAt) ||
      text.dayEndsAt <= text.dayStartsAt) {
    throw new Error('Неполные или противоречивые границы дня. Миграция отменена.')
  }
  dayBoundary(text.dayKey, text.dayStartMinutes, text.timeZone)
  if (localDayKey(text.dayStartsAt, text.timeZone) !== text.dayKey) {
    throw new Error('Дата текста не соответствует сохранённому началу дня. Миграция отменена.')
  }
  const closed = text.dayEndsAt <= now
  return {
    ...initialDayGoal(),
    userDayId, userId: text.userId, dayKey: text.dayKey,
    timeZone: text.timeZone, dayStartMinutes: text.dayStartMinutes,
    dayPolicyVersion: text.dayPolicyVersion,
    startsAt: text.dayStartsAt, endsAt: text.dayEndsAt,
    state: closed ? 'closed' : 'open',
    graceUntil: null, graceSessionId: null,
    closedAt: closed ? text.dayEndsAt : null,
    revision: 1,
  }
}
