import { useState } from 'react'
import { PUBLICATION_CHANNELS } from '../publications/model.js'

import { publicationLabels } from '../publications/labels.js'
import { attachedLiveRange } from '../publications/liveAnchors.js'
import ReadonlyDocument from './ReadonlyDocument.js'
const choices = { profile: 'В профиль', feed: 'В ленту', internet: 'В интернет' }

export default function PublicationPicker({ source, records, loading, loadError, canCreate, create, reattach, close }) {
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [candidateId, setCandidateId] = useState(null)
  const detached = records.filter(record => record.source.sourceType === source.sourceType && record.source.sourceId === source.sourceId &&
    (!record.liveAnchor || record.liveAnchor.status === 'detached'))
  const candidate = detached.find(record => record.publicationId === candidateId)
  const existing = new Set(records.filter(record => {
    const range = attachedLiveRange(record, source.sourceRevision)
    return record.source.sourceId === source.sourceId && record.source.sourceType === source.sourceType &&
      range?.from === source.range.from && range?.to === source.range.to
  }).map(record => record.channel))
  const channels = selected.filter(channel => !existing.has(channel))
  return <div className="publication-picker" role="group" aria-label="Каналы публикации" aria-busy={busy}
    onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); close() } }}>
    <strong>Опубликовать</strong>
    {PUBLICATION_CHANNELS.map(channel => <label key={channel}>
      <input type="checkbox" checked={existing.has(channel) || selected.includes(channel)} disabled={busy || loading || !!loadError || existing.has(channel) || !canCreate || !!candidateId}
        onChange={event => setSelected(previous => event.target.checked ? [...previous, channel] : previous.filter(item => item !== channel))} />
      {existing.has(channel) ? publicationLabels[channel] : choices[channel]}
    </label>)}
    {error || loadError ? <p role="alert">{error ?? 'Не удалось проверить публикации. Закройте выбор каналов и попробуйте снова.'}</p> : null}
    <button disabled={busy || loading || !!loadError || !canCreate || !channels.length || !!candidateId} onClick={async () => {
      setBusy(true); setError(null)
      try { await create(source, channels); close() }
      catch (failure) {
        setError(failure.name === 'ConstraintError' ? 'Этот фрагмент уже опубликован в одном из выбранных каналов. Закройте выбор каналов и откройте снова.'
          : 'Не удалось создать публикацию. Проверьте, что текст сохранён и не изменён в другой вкладке, затем выделите фрагмент заново.')
      } finally { setBusy(false) }
    }}>{busy ? 'Публикация…' : 'Опубликовать'}</button>
    {reattach && detached.length ? <div className="publication-reattach" role="group" aria-label="Привязка существующей публикации">
      <p>Привязать существующую публикацию к выделенному фрагменту</p>
      {candidateId ? candidate ? <>
        <p>{publicationLabels[candidate.channel]} · {candidate.snapshot.title ?? 'Без названия'}</p>
        <div className="publication-reattach-snapshot"><ReadonlyDocument record={candidate.snapshot} /></div>
        <button disabled={busy || loading || !!loadError || !canCreate} onClick={async () => {
          setBusy(true); setError(null)
          try { await reattach(candidate.publicationId, source); close() }
          catch (failure) { setError(failure.name === 'ConstraintError' ? 'Этот диапазон уже связан с публикацией в данном канале.'
            : 'Не удалось привязать публикацию. Проверьте её состояние и выделите фрагмент заново.') }
          finally { setBusy(false) }
        }}>Привязать к выделенному фрагменту</button>
      </> : <p>Публикация недоступна. Закройте панель и попробуйте снова.</p> : detached.map(record => <button key={record.publicationId}
        onMouseDown={event => event.preventDefault()}
        disabled={busy || loading || !!loadError || !canCreate} onClick={() => { setCandidateId(record.publicationId); setError(null) }}>
        {publicationLabels[record.channel]} · {record.snapshot.title ?? 'Без названия'} · {new Date(record.publishedAt).toLocaleString('ru-RU')}
      </button>)}
    </div> : null}
    <button disabled={busy} onClick={close}>Отмена</button>
  </div>
}
