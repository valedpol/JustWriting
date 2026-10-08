import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { listOwnPublications, deletePublication } from '../storage/publicationRepository.js'
import { maintenance } from '../runtime/maintenance.js'
import { getWordCount } from '../domain/wordCount.js'
import { archiveDateTop } from '../domain/archiveViewport.js'
import ReadonlyDocument from './ReadonlyDocument.js'
import PublicationPreview from './PublicationPreview.jsx'
import './OwnerPublications.css'

const ownerChannelLabels = { profile: 'Профиль', feed: 'Лента', internet: 'Интернет' }
const removalLabels = { profile: 'Профиля', feed: 'Ленты', internet: 'Интернета' }
const publicationDate = value => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
const writingDate = dayKey => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${dayKey}T00:00:00Z`)).replace(/\s*г\.$/, '')

export default function OwnerPublications({ userId, channel, onBusyChange = () => {}, onCountChange, onWordCountChange, metadataHost, emptyMessage = 'Здесь пока нет публикаций.' }) {
  const [records, setRecords] = useState(null)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [confirmationAction, setConfirmationAction] = useState('cancel')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const toggle = publicationId => setExpanded(previous => {
    const next = new Set(previous)
    if (next.has(publicationId)) next.delete(publicationId)
    else next.add(publicationId)
    return next
  })
  const view = useRef(null), scrollArea = useRef(null), header = useRef(null), rail = useRef(null)
  const articles = useRef(new Map()), notes = useRef(new Map())
  const blocked = useSyncExternalStore(maintenance.subscribe, maintenance.blocked)
  useEffect(() => {
    let live = true
    listOwnPublications(userId, channel).then(items => {
      if (live) { setRecords(items); onCountChange?.(channel, items.length) }
    })
      .catch(() => { if (live) setError('Не удалось загрузить публикации. Откройте канал снова.') })
    return () => { live = false }
  }, [userId, channel, onCountChange])
  useEffect(() => {
    onWordCountChange?.(channel, records === null ? null : records.reduce((total, record) => total + getWordCount(record.snapshot.content), 0))
  }, [channel, records, onWordCountChange])
  useLayoutEffect(() => {
    const scroller = scrollArea.current
    if (!scroller || !metadataHost || !rail.current) return
    const measure = () => {
      const viewport = scroller.getBoundingClientRect(), host = metadataHost.getBoundingClientRect()
      const top = Math.max(viewport.top, header.current.getBoundingClientRect().bottom + 8)
      rail.current.style.top = `${top - host.top}px`
      rail.current.style.height = `${Math.max(0, viewport.bottom - top)}px`
      for (const record of records ?? []) {
        const article = articles.current.get(record.publicationId), note = notes.current.get(record.publicationId)
        if (!article || !note) continue
        const height = note.getBoundingClientRect().height
        const style = getComputedStyle(article)
        const inset = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
          .reduce((total, name) => total + (parseFloat(style[name]) || 0), 0)
        article.style.setProperty('--publication-metadata-height', `${height + inset}px`)
        const bounds = article.getBoundingClientRect()
        const contentTop = (article.querySelector('h2') ?? article.querySelector('.owner-publication-text')).getBoundingClientRect().top
        note.style.top = `${archiveDateTop(contentTop - top, bounds.bottom - top, height)}px`
      }
    }
    measure()
    scroller.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(scroller); observer.observe(view.current); observer.observe(metadataHost)
    for (const note of notes.current.values()) observer.observe(note)
    for (const article of articles.current.values()) observer.observe(article)
    return () => { scroller.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); observer.disconnect() }
  }, [records, metadataHost, confirmation, busy, expanded])
  const remove = async publicationId => {
    setBusy(true); onBusyChange(true); setError('')
    try {
      await deletePublication(userId, publicationId)
      const remaining = records.filter(item => item.publicationId !== publicationId)
      setRecords(remaining)
      onCountChange?.(channel, remaining.length)
      setConfirmation(null)
    } catch {
      setError('Не удалось снять публикацию. Откройте канал снова и проверьте её состояние.')
    } finally { setBusy(false); onBusyChange(false) }
  }
  return <><section ref={view} className="editor-shell owner-publications" aria-label={`Публикации: ${ownerChannelLabels[channel]}`} aria-busy={busy}>
    <div ref={scrollArea} className="archive-scroll owner-publications-scroll">
    <h1 ref={header}><span className="archive-calendar-heading">{ownerChannelLabels[channel]}</span></h1>
    <div className="owner-publications-content">
    {error ? <p role="alert">{error}</p> : null}
    {records === null && !error ? <p role="status">Загрузка…</p> : null}
    {records?.length === 0 ? <p>{emptyMessage}</p> : null}
    {records?.map(record => <article className="owner-publication" key={record.publicationId}
      onClick={() => { if (!expanded.has(record.publicationId)) toggle(record.publicationId) }}
      ref={node => { if (node) articles.current.set(record.publicationId, node); else articles.current.delete(record.publicationId) }}>
      <h2 className={record.snapshot.title === undefined ? 'is-placeholder' : undefined}>
        <button type="button" aria-expanded={expanded.has(record.publicationId)}
          aria-label={`${expanded.has(record.publicationId) ? 'Схлопнуть' : 'Раскрыть'} публикацию`}
          onClick={event => { event.stopPropagation(); toggle(record.publicationId) }}>{record.snapshot.title ?? 'Без названия'}</button>
      </h2>
      {expanded.has(record.publicationId)
        ? <div className="owner-publication-text"><ReadonlyDocument record={record.snapshot} /></div>
        : <PublicationPreview snapshot={record.snapshot} />}
      <div className="owner-publication-written">Написано <time dateTime={record.source.archive.dayKey}>{writingDate(record.source.archive.dayKey)}</time></div>
    </article>)}
    </div>
    </div>
  </section>
    {metadataHost ? createPortal(<div ref={rail} className="owner-publication-rail" aria-label="Сведения о публикациях">
      {records?.map(record => <div className="owner-publication-metadata" key={record.publicationId}
        ref={node => { if (node) notes.current.set(record.publicationId, node); else notes.current.delete(record.publicationId) }}>
        <time dateTime={new Date(record.publishedAt).toISOString()}>{publicationDate(record.publishedAt)}</time>
      {confirmation === record.publicationId ? <div className="owner-publication-confirmation" role="group" aria-label="Подтверждение снятия публикации">
        <span>Снять публикацию из {removalLabels[channel]}?</span>
        <div className="owner-publication-confirmation-actions">
          <button type="button" className={confirmationAction === 'remove' ? 'is-active' : undefined} onFocus={() => setConfirmationAction('remove')}
            disabled={busy || blocked} onClick={() => remove(record.publicationId)}>{busy ? 'Снятие…' : 'Снять'}</button>
          <button type="button" autoFocus className={confirmationAction === 'cancel' ? 'is-active' : undefined} onFocus={() => setConfirmationAction('cancel')}
            disabled={busy} onClick={() => setConfirmation(null)}>Отмена</button>
        </div>
      </div> : <button type="button" disabled={busy || blocked} onClick={() => { setConfirmation(record.publicationId); setConfirmationAction('cancel'); setError('') }}>Снять с публикации</button>}
      </div>)}
    </div>, metadataHost) : null}
  </>
}
