import { transaction } from './database.js'
import { publicProfileSettingsKey, profilePublicationProjection, sortPublications } from '../publications/model.js'
import { resolvePublicIdentity } from '../domain/publicIdentity.js'
import { publicAuthorStats } from '../domain/publicProfile.js'
import { writingEntries } from '../domain/research.js'
import { createPublicIdentityRepository } from './publicIdentityRepository.js'

export function createPublicProfileRepository({ runTransaction = transaction, authorStatsProvider = async () => null, authorProfileProvider } = {}) {
  const identities = createPublicIdentityRepository({ runTransaction, authorProfileProvider })
  const readAuthor = publicId => runTransaction(['settings'], 'readonly', (tx, done) => {
    const read = tx.objectStore('settings').getAll()
    read.onsuccess = () => {
      const matches = read.result.filter(row => row.key === publicProfileSettingsKey(row.userId) && row.publicId === publicId)
      done({ settings: matches.length === 1 ? matches[0] : null, local: read.result.find(row => row.key === 'localProfile') })
    }
  })
  const repository = {
    loadOwnProfilePin(userId) {
      if (typeof userId !== 'string' || !userId) throw new Error('Invalid profile owner')
      return runTransaction(['settings', 'publications'], 'readonly', (tx, done) => {
        const settings = tx.objectStore('settings').get(publicProfileSettingsKey(userId))
        settings.onsuccess = () => {
          const id = settings.result?.pinnedPublicationId
          if (!id) { done(null); return }
          const publication = tx.objectStore('publications').get(id)
          publication.onsuccess = () => done(publication.result?.userId === userId && publication.result?.channel === 'profile' ? id : null)
        }
      })
    },
    async loadPublicAuthorStats(publicId) {
      if (typeof publicId !== 'string' || !publicId) return null
      const { settings, local } = await readAuthor(publicId)
      if (settings?.profileVisible !== true) return null
      let stats
      if (local?.userId !== settings.userId) stats = publicAuthorStats(await authorStatsProvider(publicId))
      else {
        // Local repository adapter only: Reader UI receives aggregates, never texts.
        stats = await runTransaction(['texts', 'userDays'], 'readonly', (tx, done) => {
          const texts = tx.objectStore('texts').index('userId').getAll(local.userId)
          const days = tx.objectStore('userDays').index('userId').getAll(local.userId)
          days.onsuccess = () => {
            const entries = writingEntries(texts.result, days.result)
            done(publicAuthorStats({ joinedAt: local.createdAt, writingDays: entries.size,
              totalWords: [...entries.values()].reduce((sum, entry) => sum + entry.words, 0) }))
          }
        })
      }
      const latest = await readAuthor(publicId)
      return latest.settings?.profileVisible === true && latest.settings.userId === settings.userId ? stats : null
    },
    async loadPublicProfile(publicId) {
      if (typeof publicId !== 'string' || !publicId) return null
      const { settings } = await readAuthor(publicId)
      if (settings?.profileVisible !== true) return null
      const publications = await runTransaction(['publications'], 'readonly', (tx, done, fail) => {
        const read = tx.objectStore('publications').index('userChannelTime').getAll(IDBKeyRange.bound([settings.userId, 'profile', 0], [settings.userId, 'profile', Number.MAX_SAFE_INTEGER]))
        read.onsuccess = () => {
          try { done(sortPublications(read.result).map(profilePublicationProjection)) } catch (error) { fail(error) }
        }
      })
      const [stats, fullName] = await Promise.all([
        repository.loadPublicAuthorStats(publicId).catch(() => null), identities.loadDisclosedAuthorName(publicId).catch(() => null),
      ])
      // A permission revoked while a provider was loading must win.
      const latest = await readAuthor(publicId)
      if (latest.settings?.profileVisible !== true || latest.settings.userId !== settings.userId) return null
      const identity = resolvePublicIdentity(settings.userId, latest.settings)
      const pinnedIndex = publications.findIndex(record => record.publicationId === identity.pinnedPublicationId)
      const pinnedPublicationId = pinnedIndex >= 0 ? identity.pinnedPublicationId : null
      if (pinnedIndex > 0) publications.unshift(...publications.splice(pinnedIndex, 1))
      return Object.freeze({ publicId: identity.publicId, displayName: identity.displayName,
        fullName: identity.allowNameDisclosure ? fullName : null, stats,
        about: identity.about, links: identity.links, pinnedPublicationId, publications: Object.freeze(publications) })
    },
  }
  return repository
}
const repository = createPublicProfileRepository()
export const loadPublicAuthorStats = (...args) => repository.loadPublicAuthorStats(...args)
export const loadPublicProfile = (...args) => repository.loadPublicProfile(...args)
export const loadOwnProfilePin = (...args) => repository.loadOwnProfilePin(...args)
