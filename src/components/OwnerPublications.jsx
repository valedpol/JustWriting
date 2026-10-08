import { useEffect, useState } from 'react'
import { listOwnPublications, deletePublication } from '../storage/publicationRepository.js'
import { getWordCount } from '../domain/wordCount.js'
import PublicationView from './PublicationView.jsx'

const ownerChannelLabels = { profile: 'Профиль', feed: 'Лента', internet: 'Интернет' }

export default function OwnerPublications({ userId, channel, onBusyChange, onCountChange, onWordCountChange, metadataHost, emptyMessage }) {
  const [records, setRecords] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    listOwnPublications(userId, channel).then(items => {
      if (live) { setRecords(items); onCountChange?.(channel, items.length) }
    }).catch(() => { if (live) setError('Не удалось загрузить публикации. Откройте канал снова.') })
    return () => { live = false }
  }, [userId, channel, onCountChange])
  useEffect(() => {
    onWordCountChange?.(channel, records === null ? null : records.reduce((total, record) => total + getWordCount(record.snapshot.content), 0))
  }, [channel, records, onWordCountChange])
  const remove = async publicationId => {
    await deletePublication(userId, publicationId)
    const remaining = records.filter(item => item.publicationId !== publicationId)
    setRecords(remaining)
    onCountChange?.(channel, remaining.length)
  }
  return <PublicationView records={records} error={error} channel={channel} heading={ownerChannelLabels[channel]}
    canRemove={() => true} onRemove={remove} onBusyChange={onBusyChange} metadataHost={metadataHost} emptyMessage={emptyMessage} />
}
