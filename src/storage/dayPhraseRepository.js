import markdown from '../content/daily-phrases.md?raw'
import { parseDayPhrases, selectDayPhrase } from '../domain/dayPhrase.js'
import { calculateUserDay } from '../domain/writingDay.js'
import { transaction } from './database.js'

export const dayPhrases = Object.freeze(parseDayPhrases(markdown))
export const dayPhraseKey = userId => `dayPhrase:${userId}`

export function createDayPhraseRepository({ runTransaction = transaction, random = Math.random } = {}) {
  function choose(profile, now, authEventId = null) {
    if (!profile?.userId) return Promise.reject(new Error('Day phrase requires a user'))
    const { dayKey } = calculateUserDay({ ...profile, now })
    return runTransaction(['settings'], 'readwrite', (tx, done, fail) => {
      const store = tx.objectStore('settings'), owner = store.get('localProfile')
      const read = store.get(dayPhraseKey(profile.userId))
      read.onsuccess = () => {
        try {
          if (owner.result?.userId !== profile.userId || (read.result && read.result.userId !== profile.userId)) throw new Error('Day phrase owner changed')
          // Serialized read + consume + write: reloads, StrictMode and concurrent
          // application tabs all share one selection for the current user day.
          const next = selectDayPhrase(read.result, { dayKey, authEventId, phrases: dayPhrases, random })
          if (next !== read.result) store.put({ ...next, key: dayPhraseKey(profile.userId), userId: profile.userId })
          done(dayPhrases[next.selectedIndex])
        } catch (error) { fail(error) }
      }
    })
  }
  return {
    loadDayPhrase: (profile, now = Date.now()) => choose(profile, now),
    // Future real auth-success handler only. Its stable event ID makes retries
    // idempotent; opening/reloading the local app is never an auth event.
    chooseAfterAuthentication(profile, authEventId, now = Date.now()) {
      if (typeof authEventId !== 'string' || !authEventId) return Promise.reject(new Error('A real auth event ID is required'))
      return choose(profile, now, authEventId)
    },
  }
}

export const dayPhraseRepository = createDayPhraseRepository()
