import { transaction } from './database.js'
import { canWriteDay } from '../domain/grace.js'
import { getWordCount } from '../domain/wordCount.js'

export const SAMPLE_INTERVAL = 5 * 60 * 1000

// Observe committed content, never reconstruct missed intervals or mutate the day.
export function sampleWordCount(userId, userDayId, sessionId, now) {
  if (!sessionId || !userDayId) return Promise.resolve(null)
  return transaction(['wordCountSamples', 'userDays', 'texts'], 'readwrite', (tx, done) => {
    const timestamp = now ?? Date.now()
    const days = tx.objectStore('userDays')
    const read = days.get(userDayId)
    read.onsuccess = () => {
      const day = read.result
      if (!day || day.userId !== userId || !canWriteDay(day, timestamp, sessionId)) { done(null); return }
      const samples = tx.objectStore('wordCountSamples')
      const range = IDBKeyRange.bound([userDayId, -Infinity], [userDayId, Infinity])
      const latest = samples.index('userDayTime').openCursor(range, 'prev')
      latest.onsuccess = () => {
        const previous = latest.result?.value
        if (previous && timestamp - previous.timestamp < SAMPLE_INTERVAL) { done(null); return }
        const textRead = tx.objectStore('texts').index('userDayId').get(userDayId)
        textRead.onsuccess = () => {
          const text = textRead.result
          if (!text || text.userId !== userId) { done(null); return }
          const sample = {
            sampleId: crypto.randomUUID(), userId, userDayId, dayKey: day.dayKey,
            timestamp, wordCount: getWordCount(text.content), textRevision: text.revision,
          }
          samples.add(sample)
          done(sample)
        }
      }
    }
  })
}
