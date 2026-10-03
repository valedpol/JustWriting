import { maintenance } from '../runtime/maintenance.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { registerBackupFlush } from '../backup/backup.js'
import { loadProfile } from '../storage/textRepository.js'
import { saveProfileSetting } from '../storage/settingsRepository.js'
import { openWritingController } from '../editor/writingController.js'

export function useTodayText() {
  const [controller, setController] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [localProfile, setProfile] = useState(null)
  const [loadError, setLoadError] = useState('')
  const profile = useRef(null)
  const active = useRef(null)
  useEffect(() => {
    let stopped = false
    let unsubscribe
    let checking = false
    const check = async () => {
      if (maintenance.blocked() || checking || !active.current) return
      checking = true
      try {
        const latest = await loadProfile()
        if (stopped) return
        profile.current = latest; setProfile(latest)
        await active.current.check()
      } catch (error) { if (!stopped) setLoadError(error.message) }
      finally { checking = false }
    }
    loadProfile().then(async value => {
      if (stopped) return
      profile.current = value; setProfile(value)
      const current = await openWritingController({ profile: value, getProfile: () => profile.current })
      if (stopped) return
      active.current = current; setController(current); setSnapshot(current.snapshot)
      unsubscribe = current.subscribe(setSnapshot)
    }).catch(error => { if (!stopped) setLoadError(error.message) })
    const timer = setInterval(check, 1000)
    const visible = () => { if (document.visibilityState === 'visible') check() }
    const leave = () => {
      if (maintenance.blocked()) return
      const current = active.current
      if (current) current.finishComposition().then(() => current.endWriting()).catch(() => {})
    }
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', check)
    window.addEventListener('pagehide', leave)
    document.addEventListener('visibilitychange', visible)
    return () => {
      stopped = true; unsubscribe?.(); active.current = null
      clearInterval(timer)
      window.removeEventListener('focus', check); window.removeEventListener('pageshow', check)
      window.removeEventListener('pagehide', leave); document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  useEffect(() => {
    if (!['saving', 'error'].includes(snapshot?.status) && !controller?.composing) return
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [snapshot, controller])
  const flush = useCallback(() => active.current?.flush() ?? Promise.resolve(), [])
  useEffect(() => registerBackupFlush(async () => {
    if (!active.current) throw new Error('Writing controller is not ready')
    await active.current.flush()
  }), [])
  const updateSetting = (field, value) => maintenance.normalOperation(async () => {
    await flush()
    const result = await saveProfileSetting(profile.current.userId, field, value)
    profile.current = result.profile; setProfile(result.profile)
    await active.current.check()
    return result
  })
  return {
    controller, text: snapshot?.text ?? '', status: loadError ? 'load-error' : snapshot?.status ?? 'loading',
    error: loadError || snapshot?.error || '', userId: localProfile?.userId ?? null,
    ready: Boolean(snapshot?.writable), localProfile, updateSetting,
    dayEndsAt: snapshot?.context.dayEndsAt ?? null, graceUntil: snapshot?.context.graceUntil ?? null,
    endWriting: () => controller?.endWriting().catch(error => setLoadError(error.message)),
    retry: () => controller?.retry().catch(() => {}), flush,
  }
}
