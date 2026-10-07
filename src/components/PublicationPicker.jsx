import { useState } from 'react'
import { PUBLICATION_CHANNELS } from '../publications/model.js'

import { publicationLabels } from '../publications/labels.js'
const choices = { profile: 'В профиль', feed: 'В ленту', internet: 'В интернет' }

export default function PublicationPicker({ source, records, loading, loadError, canCreate, create, close }) {
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const existing = new Set(records.filter(record => record.source.range.from === source.range.from && record.source.range.to === source.range.to).map(record => record.channel))
  const channels = selected.filter(channel => !existing.has(channel))
  return <div className="publication-picker" role="group" aria-label="Каналы публикации" aria-busy={busy}
    onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.preventDefault(); close() } }}>
    <strong>Опубликовать</strong>
    {PUBLICATION_CHANNELS.map(channel => <label key={channel}>
      <input type="checkbox" checked={existing.has(channel) || selected.includes(channel)} disabled={busy || loading || !!loadError || existing.has(channel) || !canCreate}
        onChange={event => setSelected(previous => event.target.checked ? [...previous, channel] : previous.filter(item => item !== channel))} />
      {existing.has(channel) ? publicationLabels[channel] : choices[channel]}
    </label>)}
    {error || loadError ? <p role="alert">{error ?? 'Не удалось проверить публикации. Закройте выбор каналов и попробуйте снова.'}</p> : null}
    <button disabled={busy || loading || !!loadError || !canCreate || !channels.length} onClick={async () => {
      setBusy(true); setError(null)
      try { await create(source, channels); close() }
      catch (failure) {
        setError(failure.name === 'ConstraintError' ? 'Этот фрагмент уже опубликован в одном из выбранных каналов. Закройте выбор каналов и откройте снова.'
          : 'Не удалось создать публикацию. Проверьте, что текст сохранён и не изменён в другой вкладке, затем выделите фрагмент заново.')
      } finally { setBusy(false) }
    }}>{busy ? 'Публикация…' : 'Опубликовать'}</button>
    <button disabled={busy} onClick={close}>Отмена</button>
  </div>
}
