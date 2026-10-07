import { transaction } from './database.js'
import { createArchiveSourceAdapter } from './archiveSourceAdapter.js'
import { assertChannels, makePublication, immutablePublication, feedPublicationProjection,
  sortPublications, publicProfileSettingsKey } from '../publications/model.js'

export function createPublicationRepository({ runTransaction = transaction, flush, now = Date.now, id = () => crypto.randomUUID() } = {}) {
  const adapter = createArchiveSourceAdapter({ runTransaction, flush })
  return {
    async createPublications(userId, { source, channels }) {
      assertChannels(channels)
      const selectedChannels = [...channels]
      const prepared = await adapter.prepare(userId, source)
      return runTransaction(['texts', 'userDays', 'settings', 'publications'], 'readwrite', (tx, done, fail) => {
        const textRead = tx.objectStore('texts').get(prepared.source.sourceId)
        textRead.onsuccess = () => {
          const text = textRead.result
          if (!text || typeof text.userDayId !== 'string' || !text.userDayId) { fail(new Error('Source no longer exists or is invalid')); return }
          const dayRead = tx.objectStore('userDays').get(text.userDayId)
          dayRead.onsuccess = () => {
            try { adapter.assertCurrent(userId, prepared, text, dayRead.result) } catch (error) { fail(error); return }
            const profileRead = tx.objectStore('settings').get('localProfile')
            const settingsRead = tx.objectStore('settings').get(publicProfileSettingsKey(userId))
            // IDB requests finish in order; all reads and adds stay in this transaction.
            settingsRead.onsuccess = () => {
              try {
                const publishedAt = now()
                const records = selectedChannels.map(channel => makePublication({ publicationId: id(), userId,
                  channel, publishedAt, prepared, profile: profileRead.result, settings: settingsRead.result }))
                for (const record of records) tx.objectStore('publications').add(record)
                done(records)
              } catch (error) { fail(error) }
            }
          }
        }
      })
    },
    listOwnPublications(userId, channel) {
      assertChannels([channel])
      if (typeof userId !== 'string' || !userId) throw new Error('Invalid owner')
      return runTransaction(['publications'], 'readonly', (tx, done) => {
        const read = tx.objectStore('publications').index('userChannelTime').getAll(IDBKeyRange.bound([userId, channel, 0], [userId, channel, Number.MAX_SAFE_INTEGER]))
        read.onsuccess = () => done(sortPublications(read.result).map(immutablePublication))
      })
    },
    listFeedPublications() {
      return runTransaction(['publications'], 'readonly', (tx, done) => {
        const read = tx.objectStore('publications').index('channelTime').getAll(IDBKeyRange.bound(['feed', 0], ['feed', Number.MAX_SAFE_INTEGER]))
        read.onsuccess = () => done(sortPublications(read.result).map(feedPublicationProjection))
      })
    },
    deletePublication(userId, publicationId) {
      if (typeof userId !== 'string' || !userId || typeof publicationId !== 'string' || !publicationId) throw new Error('Invalid owner/publication')
      return runTransaction(['publications'], 'readwrite', (tx, done, fail) => {
        const store = tx.objectStore('publications'), read = store.get(publicationId)
        read.onsuccess = () => {
          if (!read.result || read.result.userId !== userId) { fail(new Error('Publication unavailable to owner')); return }
          store.delete(publicationId)
          done({ publicationId, deleted: true })
        }
      })
    },
  }
}

const repository = createPublicationRepository()
export const createPublications = (...args) => repository.createPublications(...args)
export const listOwnPublications = (...args) => repository.listOwnPublications(...args)
export const listFeedPublications = (...args) => repository.listFeedPublications(...args)
export const deletePublication = (...args) => repository.deletePublication(...args)
