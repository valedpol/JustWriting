import { transaction } from './database.js'

export function loadResearch(userId) {
  return transaction(['texts', 'userDays', 'wordCountSamples', 'settings'], 'readonly', (tx, done) => {
    const result = {}
    let pending = 4
    const read = (name, request) => {
      request.onsuccess = () => {
        result[name] = request.result
        if (!--pending) done({
          texts: result.texts.filter((row) => row.userId === userId),
          days: result.days.filter((row) => row.userId === userId),
          samples: result.samples.filter((row) => row.userId === userId),
          profile: result.profile?.userId === userId ? result.profile : null,
        })
      }
    }
    read('texts', tx.objectStore('texts').index('userId').getAll(userId))
    read('days', tx.objectStore('userDays').index('userId').getAll(userId))
    read('samples', tx.objectStore('wordCountSamples').getAll())
    read('profile', tx.objectStore('settings').get('localProfile'))
  })
}
