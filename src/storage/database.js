import { maintenance } from '../runtime/maintenance.js'
import { userDayFromText } from '../domain/userDay.js'

export const DATABASE_VERSION = 4
let connection

// Options allow migration tests against isolated databases and a fixed clock.
export function connectDatabase(options = {}) {
  return maintenance.applicationWrite(() => connectUnfenced(options))
}

function connectUnfenced({ name = 'just-writing', now = Date.now() } = {}) {
  return new Promise((resolve, reject) => {
    let migrationError
    let blocked = false
    const request = indexedDB.open(name, DATABASE_VERSION)
    request.onupgradeneeded = (event) => {
      try { maintenance.assertSchemaWrite() } catch (error) { migrationError = error; request.transaction.abort(); return }
      const db = request.result
      const tx = request.transaction
      if (event.oldVersion < 4) {
        const samples = db.createObjectStore('wordCountSamples', { keyPath: 'sampleId' })
        samples.createIndex('userDayTime', ['userDayId', 'timestamp'], { unique: true })
      }
      if (event.oldVersion < 1) {
        db.createObjectStore('settings', { keyPath: 'key' })
        const texts = db.createObjectStore('texts', { keyPath: 'textId' })
        texts.createIndex('userDay', ['userId', 'dayKey'], { unique: true })
        texts.createIndex('userId', 'userId')
      }
      if (event.oldVersion < 2) {
        const days = db.createObjectStore('userDays', { keyPath: 'userDayId' })
        days.createIndex('userDay', ['userId', 'dayKey'], { unique: true })
        days.createIndex('userId', 'userId')
        const texts = tx.objectStore('texts')
        texts.createIndex('userDayId', 'userDayId', { unique: true })
        const cursor = texts.openCursor()
        cursor.onsuccess = () => {
          if (!cursor.result) return
          try {
            const text = cursor.result.value
            const day = userDayFromText(text, now)
            days.add(day)
            cursor.result.update({ ...text, userDayId: day.userDayId })
            cursor.result.continue()
          } catch (error) {
            migrationError = error
            tx.abort()
          }
        }
      }
      if (event.oldVersion < 3) {
        const profileRead = tx.objectStore('settings').get('localProfile')
        profileRead.onsuccess = () => {
          const profile = profileRead.result
          const cursor = tx.objectStore('userDays').openCursor()
          cursor.onsuccess = () => {
            if (!cursor.result) return
            const day = cursor.result.value
            const active = day.state === 'open' && day.startsAt <= now && now < day.endsAt
            const fields = {
              dailyWordGoal: Object.hasOwn(day, 'dailyWordGoal') ? day.dailyWordGoal : (active && day.userId === profile?.userId ? profile.dailyWordGoal ?? null : null),
              goalReached: day.goalReached ?? false,
              goalReachedAt: day.goalReachedAt ?? null,
              goalAtReach: day.goalAtReach ?? null,
            }
            if (Object.entries(fields).some(([key, value]) => day[key] !== value)) {
              cursor.result.update({ ...day, ...fields, revision: day.revision + 1 })
            }
            cursor.result.continue()
          }
        }
      }

    }
    request.onerror = () => reject(migrationError || request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error('Закройте другие вкладки Just Writing и перезагрузите страницу.'))
    }
    request.onsuccess = () => {
      const db = request.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => { db.close(); connection = undefined }
      resolve(db)
    }
  })
}

export function openDatabase() {
  if (!connection) {
    connection = connectDatabase().catch((error) => { connection = undefined; throw error })
  }
  return connection
}

// Resolve only after commit, never merely after an individual request succeeds.
export function transaction(storeNames, mode, run) {
  const execute = async () => {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode)
      let result
      let failure
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(failure || tx.error || new Error('Запись отменена'))
      tx.onerror = () => { /* onabort reports failed transactions */ }
      try {
        run(tx, (value) => { result = value }, (error) => { failure = error; tx.abort() })
      } catch (error) {
        failure = error
        tx.abort()
      }
    })
  }
  return mode === 'readwrite' ? maintenance.applicationWrite(execute) : execute()
}
