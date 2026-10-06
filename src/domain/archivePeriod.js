import { getWordCount } from './wordCount.js'

// Saved dayKey is authoritative, including historical and legacy records.
export function filterArchivePeriod(records, period) {
  return period === null ? records : records.filter(record => record.dayKey === period || record.dayKey.startsWith(period + '-'))
}

export function archiveCalendarEntries(records) {
  const entries = new Map()
  for (const record of records) {
    const previous = entries.get(record.dayKey)
    entries.set(record.dayKey, { day: {}, words: (previous?.words ?? 0) + getWordCount(record.content) })
  }
  return entries
}
