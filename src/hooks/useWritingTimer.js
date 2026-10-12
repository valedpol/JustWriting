import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export function timerMinutes(value) {
  return /^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 999 ? Number(value) : null
}

export function timerCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

// UI-only session: neither the deadline nor the result is persisted.
export function useWritingTimer(readWordCount) {
  const count = useRef(readWordCount)
  useLayoutEffect(() => { count.current = readWordCount }, [readWordCount])
  const [session, setSession] = useState(null)
  const [remaining, setRemaining] = useState(0)
  const [result, setResult] = useState(null)
  useEffect(() => {
    if (!session) return
    let finished = false
    const tick = () => {
      if (finished) return
      const left = session.deadline - Date.now()
      if (left <= 0) {
        finished = true
        setResult(Math.max(0, count.current() - session.initialWords))
        setSession(null)
        setRemaining(0)
      } else setRemaining(left)
    }
    const interval = setInterval(tick, 250)
    tick()
    return () => clearInterval(interval)
  }, [session])
  return {
    running: Boolean(session), remaining, result,
    start(value) {
      const minutes = timerMinutes(value)
      if (minutes === null || session || result !== null) return false
      const duration = minutes * 60_000
      setSession({ deadline: Date.now() + duration, initialWords: count.current() })
      setRemaining(duration)
      return true
    },
    dismissResult: () => setResult(null),
  }
}
