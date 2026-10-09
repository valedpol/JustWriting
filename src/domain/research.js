import { getWordCount } from './wordCount.js'
import { calculateUserDay } from './writingDay.js'

export function shiftDate(key, delta) {
  const date = new Date(key + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

// Shared archive-derived writing totals; publications never enter this map.
export function writingEntries(texts, days) {
  const byId = new Map(days.map(day => [day.userDayId, day]))
  const entries = new Map()
  for (const text of texts) {
    const day = byId.get(text.userDayId)
    if (day && day.userId === text.userId) entries.set(day.dayKey, { day, text, words: getWordCount(text.content) })
  }
  return entries
}

export function researchData({ texts, days, samples, profile }, now) {
  const byId = new Map(days.map((day) => [day.userDayId, day]))
  const entries = writingEntries(texts, days)
  const tags = new Set(), titles = new Set()
  for (const text of texts) {
    const day = byId.get(text.userDayId)
    if (!day || day.userId !== text.userId) continue
    for (const item of text.semanticMarkup ?? []) {
      if (typeof item.value !== 'string' || !item.value.trim()) continue
      if (item.kind === 'tag') tags.add(item.value)
      if (item.kind === 'title') titles.add(item.value)
    }
  }
  const calendar = calculateUserDay({ ...profile, now })
  const open = days.filter((day) => day.state === 'open' && day.startsAt <= now && now < day.endsAt)
    .sort((a, b) => b.startsAt - a.startsAt)[0]
  const current = open ?? days.find((day) => day.dayKey === calendar.dayKey) ?? calendar
  const currentKey = current.dayKey
  const unfinished = current.state !== 'closed' && now < current.endsAt
  let cursor = entries.has(currentKey) ? currentKey : unfinished ? shiftDate(currentKey, -1) : null
  let streak = 0
  while (cursor && entries.has(cursor)) { streak++; cursor = shiftDate(cursor, -1) }
  const sortedSamples = samples.filter((point) => byId.has(point.userDayId) && byId.get(point.userDayId).userId === point.userId)
    .slice().sort((a, b) => a.timestamp - b.timestamp)
  return {
    entries, currentKey, streak, writingDays: entries.size, tagCount: tags.size, titleCount: titles.size,
    totalWords: [...entries.values()].reduce((sum, entry) => sum + entry.words, 0),
    samples: sortedSamples,
  }
}
