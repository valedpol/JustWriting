import { transaction } from './database.js'
import { publicProfileSettingsKey } from '../publications/model.js'
import { assertPublicNicknameAvailable, initializePublicIdentity, normalizePublicNickname, resolvePublicIdentity } from '../domain/publicIdentity.js'

export function createPublicIdentityRepository({ runTransaction = transaction, authorProfileProvider = async () => null } = {}) {
  const readIdentity = userId => runTransaction(['settings'], 'readonly', (tx, done) => {
    const read = tx.objectStore('settings').get(publicProfileSettingsKey(userId))
    read.onsuccess = () => done(read.result)
  })
  return {
    async loadPublicIdentity(userId) {
      if (typeof userId !== 'string' || !userId) throw new Error('Invalid public profile owner')
      let settings = await readIdentity(userId)
      if (settings?.publicId === undefined || settings?.publicAlias === undefined || settings?.allowNameDisclosure === undefined) {
        settings = await runTransaction(['settings'], 'readwrite', (tx, done, fail) => {
          const store = tx.objectStore('settings'), read = store.get(publicProfileSettingsKey(userId))
          read.onsuccess = () => {
            try {
              // Re-read inside the serialized write: concurrent callers keep the first alias.
              const next = { ...initializePublicIdentity(userId, read.result), key: publicProfileSettingsKey(userId) }
              store.put(next); done(next)
            } catch (error) { fail(error) }
          }
        })
      }
      return resolvePublicIdentity(userId, settings)
    },
    async loadDisclosedAuthorName(publicId) {
      if (typeof publicId !== 'string' || !publicId) return null
      const readPermission = () => runTransaction(['settings'], 'readonly', (tx, done) => {
        const read = tx.objectStore('settings').getAll()
        read.onsuccess = () => {
          const matches = read.result.filter(record => record.key === publicProfileSettingsKey(record.userId) && record.publicId === publicId)
          done({ identity: matches.length === 1 ? matches[0] : null, profile: read.result.find(record => record.key === 'localProfile') })
        }
      })
      const { identity, profile } = await readPermission()
      if (identity?.allowNameDisclosure !== true) return null
      // No historical publication author data and no additional stored name.
      const name = profile?.userId === identity.userId ? profile.displayName : await authorProfileProvider(identity.userId)
      if (typeof name !== 'string' || !name.trim()) return null
      // A provider can be asynchronous: consent revoked meanwhile must win.
      const latest = await readPermission()
      if (latest.identity?.userId !== identity.userId || latest.identity?.allowNameDisclosure !== true) return null
      return latest.profile?.userId === identity.userId ? latest.profile.displayName || null : name
    },
    async savePublicIdentitySetting(userId, field, value) {
      if (typeof userId !== 'string' || !userId) throw new Error('Invalid public profile owner')
      if (!['publicNickname', 'allowNameDisclosure'].includes(field)) throw new Error('Invalid public identity setting')
      if (field === 'publicNickname') value = normalizePublicNickname(value)
      else if (typeof value !== 'boolean') throw new Error('Разрешение раскрывать имя должно быть boolean.')
      return runTransaction(['settings'], 'readwrite', (tx, done, fail) => {
        const store = tx.objectStore('settings'), profile = store.get('localProfile')
        const current = store.get(publicProfileSettingsKey(userId))
        current.onsuccess = () => {
          if (profile.result?.userId !== userId || (current.result && current.result.userId !== userId)) {
            fail(new Error('Профиль изменился. Перезагрузите страницу.')); return
          }
          try {
            const next = { ...initializePublicIdentity(userId, current.result), key: publicProfileSettingsKey(userId), [field]: value }
            const commit = () => {
              store.put(next)
              done({ profile: profile.result, publicProfile: next, deferred: false })
            }
            if (field !== 'publicNickname') { commit(); return }
            // Local directory only. Read + collision check + write share the same
            // serialized transaction, including concurrent tabs/fixture authors.
            const directory = store.getAll()
            directory.onsuccess = () => {
              try {
                const identities = directory.result.filter(record =>
                  record.key === publicProfileSettingsKey(record.userId) && record.userId !== userId)
                assertPublicNicknameAvailable(value, next.publicId, identities)
                commit()
              } catch (error) { fail(error) }
            }
          } catch (error) { fail(error) }
        }
      })
    },
    savePublicNickname(userId, value) { return this.savePublicIdentitySetting(userId, 'publicNickname', value) },
  }
}

const repository = createPublicIdentityRepository()
export const loadPublicIdentity = (...args) => repository.loadPublicIdentity(...args)
export const savePublicNickname = (...args) => repository.savePublicNickname(...args)
export const savePublicIdentitySetting = (...args) => repository.savePublicIdentitySetting(...args)

export const loadDisclosedAuthorName = (...args) => repository.loadDisclosedAuthorName(...args)
