import { transaction } from './database.js'
import { maintenance } from '../runtime/maintenance.js'
import { assertArchiveSource, prepareArchiveSnapshot, archiveSourceFingerprint } from '../publications/archiveSource.js'

export function createArchiveSourceAdapter({ runTransaction = transaction, flush = async () => {
  if (!maintenance.hasRegisteredFlush()) throw new Error('A live source flush is required')
  await maintenance.flushPending()
} } = {}) {
  return {
    async prepare(userId, request) {
      // Capture caller-owned inputs before awaiting a save queue.
      const source = structuredClone(request)
      if (source?.sourceType !== 'archive') throw new Error('Unsupported source type')
      await flush()
      const { text, day } = await runTransaction(['texts', 'userDays'], 'readonly', (tx, done) => {
        const textRead = tx.objectStore('texts').get(source.sourceId)
        textRead.onsuccess = () => {
          const text = textRead.result
          if (!text || typeof text.userDayId !== 'string' || !text.userDayId) { done({ text }); return }
          const dayRead = tx.objectStore('userDays').get(text.userDayId)
          dayRead.onsuccess = () => done({ text, day: dayRead.result })
        }
      })
      return { request: source, ...await prepareArchiveSnapshot(userId, source, text, day) }
    },
    assertCurrent(userId, prepared, text, day) {
      assertArchiveSource(userId, prepared.request, text, day)
      if (archiveSourceFingerprint(text, day) !== prepared.fingerprint) throw new Error('Source changed during publication preparation')
    },
  }
}
