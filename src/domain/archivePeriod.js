import { getWordCount } from './wordCount.js'

// Saved dayKey is authoritative, including historical and legacy records.
export function filterArchivePeriod(records, period) {
  return period === null ? records : records.filter(record => record.dayKey === period || record.dayKey.startsWith(period + '-'))
}

export function archiveCalendarEntries(records, days = []) {
  const entries = new Map()
  const savedDays = new Map(days.map(day => [day.dayKey, day]))
  for (const record of records) {
    const previous = entries.get(record.dayKey)
    entries.set(record.dayKey, { day: savedDays.get(record.dayKey) ?? {}, words: (previous?.words ?? 0) + getWordCount(record.content) })
  }
  return entries
}
