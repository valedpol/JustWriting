import { useEffect, useRef, useState } from 'react'
import { listOwnPublications, deletePublication } from '../storage/publicationRepository.js'
import { getWordCount } from '../domain/wordCount.js'
import PublicationView from './PublicationView.jsx'
import { loadOwnProfilePin } from '../storage/publicProfileRepository.js'
import { savePublicIdentitySetting } from '../storage/publicIdentityRepository.js'

const ownerChannelLabels = { profile: 'Профиль', feed: 'Лента', internet: 'Интернет' }

export default function OwnerPublications({ userId, channel, onBusyChange, onCountChange, onWordCountChange, metadataHost, emptyMessage }) {
  const [records, setRecords] = useState(null)
  const [error, setError] = useState('')
  const [pinnedPublicationId, setPin] = useState(null), [pinBusy, setPinBusy] = useState(false)
  const generation = useRef(0)
  useEffect(() => {
    let live = true
    const invalidatePending = () => { ++generation.current }
    const reload = async () => {
      const request = ++generation.current
      try {
        const [items, pin] = await Promise.all([listOwnPublications(userId, channel), channel === 'profile' ? loadOwnProfilePin(userId) : null])
        if (live && request === generation.current) { setRecords(items); setPin(pin); setError(''); onCountChange?.(channel, items.length) }
      } catch { if (live && request === generation.current) setError('Не удалось загрузить публикации. Откройте канал снова.') }
    }
    reload(); window.addEventListener('focus', reload)
    return () => { live = false; invalidatePending(); window.removeEventListener('focus', reload) }
  }, [userId, channel, onCountChange])
  useEffect(() => {
    onWordCountChange?.(channel, records === null ? null : records.reduce((total, record) => total + getWordCount(record.snapshot.content), 0))
  }, [channel, records, onWordCountChange])
  const remove = async publicationId => {
    await deletePublication(userId, publicationId)
    if (pinnedPublicationId === publicationId) setPin(null)
    const remaining = records.filter(item => item.publicationId !== publicationId)
    setRecords(remaining)
    onCountChange?.(channel, remaining.length)
  }
  const pin = async publicationId => {
    if (pinBusy) return
    const request = ++generation.current
    setPinBusy(true); onBusyChange?.(true); setError('')
    try {
      const result = await savePublicIdentitySetting(userId, 'pinnedPublicationId', publicationId === pinnedPublicationId ? null : publicationId)
      if (request === generation.current) setPin(result.publicProfile.pinnedPublicationId)
    } catch (error) { if (request === generation.current) setError(error.message) }
    finally { setPinBusy(false); onBusyChange?.(false) }
  }
  return <PublicationView records={records} error={error} channel={channel} heading={ownerChannelLabels[channel]}
    actionBusy={pinBusy} renderOwnerActions={channel === 'profile' ? (record, { disabled }) => <button type="button" disabled={disabled}
      onClick={() => pin(record.publicationId)}>{record.publicationId === pinnedPublicationId ? 'Открепить' : 'Закрепить в профиле'}</button> : undefined}
    canRemove={() => true} onRemove={remove} onBusyChange={onBusyChange} metadataHost={metadataHost} emptyMessage={emptyMessage} />
}
