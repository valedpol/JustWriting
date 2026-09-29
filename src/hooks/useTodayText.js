import { insertedText } from '../domain/textInsertion.js'
import { useEffect, useRef, useState } from 'react'
import { loadProfile, saveText } from '../storage/textRepository'
import { saveProfileSetting } from '../storage/settingsRepository'
import { resolveToday, endWritingSession } from '../storage/dayRepository'

export function useTodayText() {
  const [text, setValue] = useState('')
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [userId, setUserId] = useState(null)
  const [ready, setReady] = useState(false)
  const [localProfile, setLocalProfile] = useState(null)
  const [dayEndsAt, setDayEndsAt] = useState(null)
  const [graceUntil, setGraceUntil] = useState(null)
  const writingSession = useRef(null)
  const composing = useRef(false)
  const session = useRef(null)
  const profile = useRef(null)
  const buffer = useRef('')
  const queue = useRef(Promise.resolve())
  const sequence = useRef(0)
  const failed = useRef(false)

  useEffect(() => {
    if (status !== 'saving' && status !== 'error') return
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [status])

  useEffect(() => {
    let cancelled = false
    let checking = false
    const check = () => {
      if (checking) return
      checking = true
      const checkedAt = Date.now()
      const checkedSession = writingSession.current?.id
      queue.current = queue.current.then(async () => {
        if (cancelled || failed.current || composing.current) return
        try {
          profile.current = await loadProfile()
          setLocalProfile(profile.current)
          const next = await resolveToday(profile.current, checkedAt, checkedSession)
          if (cancelled) return
          const changed = !session.current || session.current.context.dayKey !== next.context.dayKey
          if (changed) { session.current = next; writingSession.current = null }
          else {
            session.current.context = next.context
            session.current.writable = next.writable
          }
          setUserId(profile.current.userId)
          setReady(next.writable)
          setGraceUntil(next.context.graceUntil)
          setDayEndsAt(next.context.dayEndsAt)
          if (changed) {
            buffer.current = next.record?.content ?? ''
            setValue(buffer.current)
            setStatus(next.record ? 'saved' : 'idle')
          }
          if (!next.writable) setError('Этот день уже закрыт. Проверьте системное время.')
        } catch (failure) {
          setError(failure.message)
          setStatus(session.current ? 'error' : 'load-error')
        }
      }).finally(() => { checking = false })
    }
    check()
    const timer = window.setInterval(check, 1000)
    const visible = () => { if (document.visibilityState === 'visible') check() }
    const leavePage = () => {
      const id = writingSession.current?.id
      writingSession.current = null
      if (id) queue.current = queue.current
        .then(() => endWritingSession(profile.current.userId, id))
        .catch(() => { /* Reload cannot recover the in-memory session even if unload cannot commit. */ })
    }
    window.addEventListener('pagehide', leavePage)
    window.addEventListener('pageshow', check)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', visible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('pagehide', leavePage)
      window.removeEventListener('pageshow', check)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])

  const setText = (content, startSession = true) => {
    if (!session.current) return
    if (composing.current) { setValue(content); return }
    const acceptedAt = Date.now()
    if (startSession && !writingSession.current) writingSession.current = { id: crypto.randomUUID() }
    const inputSession = writingSession.current?.id ?? null
    const sourceDay = session.current.context.dayKey
    const before = buffer.current
    // Extract the inserted portion so a boundary-crossing keystroke never copies
    // the previous day's whole textarea into the new day.
    const insertion = insertedText(before, content)
    buffer.current = content
    setValue(content)
    setStatus('saving')
    setError('')
    const version = ++sequence.current
    queue.current = queue.current.then(async () => {
      try {
        let target = session.current
        if (acceptedAt >= target.context.dayEndsAt || acceptedAt < target.context.dayStartsAt) {
          target = await resolveToday(profile.current, acceptedAt, inputSession)
          session.current = target
        }
        if (!target.writable) throw new Error('Этот день уже закрыт. Текст оставлен в редакторе.')
        const nextContent = sourceDay === target.context.dayKey ? content : (target.record?.content ?? '') + insertion
        target.record = await saveText(target.context, target.record, nextContent, acceptedAt, inputSession)
        failed.current = false
        if (sequence.current === version) {
          buffer.current = nextContent
          setValue(nextContent)
          setStatus(target.record ? 'saved' : 'idle')
          setGraceUntil(target.context.graceUntil)
          setDayEndsAt(target.context.dayEndsAt)
          setReady(true)
        }
      } catch (failure) {
        failed.current = true
        if (sequence.current === version) { setError(failure.message); setStatus('error') }
      }
    })
  }
  const updateSetting = (field, value) => {
    const task = queue.current.then(async () => {
      if (failed.current) throw new Error('Сначала сохраните текст: предыдущая запись завершилась ошибкой.')
      const result = await saveProfileSetting(profile.current.userId, field, value)
      profile.current = result.profile
      setLocalProfile(result.profile)
      const next = await resolveToday(result.profile, Date.now(), writingSession.current?.id)
      if (session.current.context.dayKey !== next.context.dayKey) {
        buffer.current = next.record?.content ?? ''
        setValue(buffer.current)
      }
      session.current = next
      setGraceUntil(next.context.graceUntil)
      setDayEndsAt(next.context.dayEndsAt)
      setReady(next.writable)
      return result
    })
    queue.current = task.catch(() => {})
    return task
  }
  const endWriting = () => {
    const id = writingSession.current?.id
    writingSession.current = null
    if (!id) return
    queue.current = queue.current.then(() => endWritingSession(profile.current.userId, id))
      .catch((failure) => { setError(failure.message); setStatus('error') })
  }
  const beginComposition = () => { composing.current = true }
  const finishComposition = (content) => { composing.current = false; setText(content) }
  return { text, setText, status, error, userId, ready, localProfile, updateSetting, dayEndsAt, graceUntil, endWriting, beginComposition, finishComposition, flush: () => queue.current }
}
