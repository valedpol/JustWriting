import { useEffect, useState } from 'react'
import { calculateUserDay } from '../domain/writingDay.js'
import { dayPhraseRepository } from '../storage/dayPhraseRepository.js'

export function useDayPhrase(profile, now, api = dayPhraseRepository) {
  const [selection, setSelection] = useState(null)
  const day = profile?.timeZone ? calculateUserDay({ ...profile, now }) : null
  const dayKey = day?.dayKey
  const dayStartsAt = day?.startsAt
  const userId = profile?.userId
  const timeZone = profile?.timeZone
  const dayStartMinutes = profile?.dayStartMinutes
  useEffect(() => {
    if (!userId || !dayKey) return
    let live = true
    // Use the canonical start of this already-resolved day, not a reactive
    // wall-clock tick, when requesting its stable persisted selection.
    api.loadDayPhrase({ userId, timeZone, dayStartMinutes }, dayStartsAt).then(text => {
      if (live) setSelection({ userId, dayKey, text })
    }).catch(error => console.error('Day phrase could not be loaded', error))
    return () => { live = false }
    // The existing App clock checks boundaries; ticks/renders within a day
    // must not request another choice. No auth call on mount/focus/pageshow.
  }, [userId, dayKey, dayStartsAt, timeZone, dayStartMinutes, api])
  return selection && selection.userId === userId ? selection.text : ''
}
