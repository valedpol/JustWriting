import { useState } from 'react'
import { publicationLabels } from '../publications/labels.js'

const removalLabels = { profile: 'Профиля', feed: 'Ленты', internet: 'Интернета' }

export default function PublicationMarker({ item, highlighted, onHighlight, onRemove, canRemove, ready, report }) {
  const [confirmation, setConfirmation] = useState(false)
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState('cancel')
  return <div className="publication-marker" aria-busy={busy} onClick={event => event.stopPropagation()}
    onMouseDown={event => event.preventDefault()} onKeyDown={event => {
      if (event.key === 'Escape' && !busy) { event.stopPropagation(); setConfirmation(false) }
    }}>
    <button className="publication-marker-value" disabled={!ready || busy} aria-pressed={highlighted}
      aria-label={`Показать фрагмент: ${publicationLabels[item.channel]}${item.title ? ` · ${item.title}` : ''}`} onClick={() => onHighlight?.(item.id)}>↗ {publicationLabels[item.channel]}
      {item.title ? <span className="publication-marker-title"> · {item.title}</span> : null}</button>
    {canRemove ? confirmation ? <div className="publication-marker-confirmation" role="group" aria-label="Снятие публикации">
      <span>Снять публикацию из {removalLabels[item.channel]}?</span>
      <div className="publication-marker-actions">
        <button className={action === 'remove' ? 'is-active' : undefined} onFocus={() => setAction('remove')} disabled={busy || !ready} onClick={async () => {
          setBusy(true)
          try { await onRemove(item.id); setConfirmation(false) }
          catch (error) { report(error) }
          finally { setBusy(false) }
        }}>Снять</button>
        <button className={action === 'cancel' ? 'is-active' : undefined} onFocus={() => setAction('cancel')} autoFocus disabled={busy} onClick={() => setConfirmation(false)}>Отмена</button>
      </div>
    </div> : <button className="publication-marker-remove" disabled={!ready || busy}
      aria-label={`Снять публикацию из ${removalLabels[item.channel]}`} onClick={() => { setAction('cancel'); setConfirmation(true) }}>×</button> : null}
  </div>
}
