// Pure calendar calculations. No clock reads, persistence, UI or grace handling.
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const formatters = new Map()

function formatter(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) throw new RangeError('A time zone is required')
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
      timeZone, calendar: 'iso8601', numberingSystem: 'latn', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }))
  }
  return formatters.get(timeZone)
}

function timestamp(value) {
  if (!Number.isFinite(value) || Number.isNaN(new Date(value).getTime())) throw new RangeError('Invalid timestamp')
  return value
}

function minutes(value) {
  if (!Number.isInteger(value) || value < 0 || value >= 1440) throw new RangeError('Minutes must be an integer from 0 to 1439')
  return value
}

function calendarDate(dayKey) {
  if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new RangeError('Invalid dayKey')
  const date = new Date(`${dayKey}T00:00:00.000Z`)
  if (Number.isNaN(+date) || date.toISOString().slice(0, 10) !== dayKey) throw new RangeError('Invalid calendar date')
  return +date
}

function nextDate(dayKey, count = 1) {
  return new Date(calendarDate(dayKey) + count * DAY).toISOString().slice(0, 10)
}

function partsAt(now, timeZone) {
  return Object.fromEntries(formatter(timeZone).formatToParts(new Date(timestamp(now)))
    .filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, Number(value)]))
}

function wallTime(now, timeZone) {
  const p = partsAt(now, timeZone)
  const date = new Date(0)
  date.setUTCFullYear(p.year, p.month - 1, p.day)
  date.setUTCHours(p.hour, p.minute, p.second, 0)
  return +date
}

export function localDayKey(now, timeZone) {
  const p = partsAt(now, timeZone)
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

// Ambiguous time: first occurrence. Missing time: first valid wall minute after
// the gap (e.g. 02:30 -> 03:00). An entirely skipped calendar date is rejected.
export function dayBoundary(dayKey, dayStartMinutes, timeZone) {
  const wanted = calendarDate(dayKey) + minutes(dayStartMinutes) * MINUTE
  formatter(timeZone)
  const offsets = new Set()
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = wanted + hours * 60 * MINUTE
    offsets.add(wallTime(instant, timeZone) - instant)
  }
  const candidates = [...offsets].map((offset) => wanted - offset)
    .filter((instant) => wallTime(instant, timeZone) === wanted)
  if (candidates.length) return Math.min(...candidates)

  // Rare DST gaps only; ordinary boundaries use the offset candidates above.
  let best = null
  let bestWall = Infinity
  for (let instant = wanted - 18 * 60 * MINUTE; instant <= wanted + 18 * 60 * MINUTE; instant += MINUTE) {
    const wall = wallTime(instant, timeZone)
    if (wall >= wanted && wall < calendarDate(dayKey) + DAY && wall < bestWall) {
      best = instant
      bestWall = wall
    }
  }
  if (best === null) throw new RangeError('Calendar date does not exist in this time zone')
  return best
}

export function calculateUserDay({ now, timeZone, dayStartMinutes = 0, dayPolicyVersion = 1 }) {
  timestamp(now)
  let dayKey = localDayKey(now, timeZone)
  let startsAt = dayBoundary(dayKey, dayStartMinutes, timeZone)
  if (now < startsAt) {
    dayKey = nextDate(dayKey, -1)
    startsAt = dayBoundary(dayKey, dayStartMinutes, timeZone)
  }
  return {
    dayKey, timeZone, dayStartMinutes, dayPolicyVersion, startsAt,
    endsAt: dayBoundary(nextDate(dayKey), dayStartMinutes, timeZone),
  }
}

export function isDayEnded(day, now) {
  return day.state === 'closed' || day.state === 'grace' || timestamp(now) >= timestamp(day.endsAt)
}

export function latestAllowedEnd(day) {
  return dayBoundary(nextDate(day.dayKey), 12 * 60, day.timeZone)
}

// This does not create a new day or apply a timezone change. It proposes a
// future end for an existing open day, preserving its key, start and timezone.
export function changeDayStart(day, newMinutes, now) {
  minutes(newMinutes)
  timestamp(now)
  if (isDayEnded(day, now)) return { ok: false, reason: 'day-ended' }
  if (now < timestamp(day.startsAt)) return { ok: false, reason: 'before-day-start' }
  if (newMinutes === day.dayStartMinutes) return { ok: true, day: { ...day }, changed: false }
  const limit = latestAllowedEnd(day)
  const end = dayBoundary(nextDate(day.dayKey), newMinutes, day.timeZone)
  if (end <= now) return { ok: false, reason: 'boundary-passed' }
  if (end > limit) return { ok: false, reason: 'after-next-noon' }
  return {
    ok: true, changed: true,
    day: { ...day, dayStartMinutes: newMinutes, dayPolicyVersion: day.dayPolicyVersion + 1, endsAt: end },
  }
}

export function parseDayStart(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Введите время в формате ЧЧ:ММ от 00:00 до 23:59.')
  const [hours, mins] = value.split(':').map(Number)
  return hours * 60 + mins
}
export function formatDayStart(value) {
  minutes(value)
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}
