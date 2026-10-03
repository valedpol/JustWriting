import ArchiveWritingEntry from './components/ArchiveWritingEntry.jsx'
import ReadonlySemanticMarkup from './components/ReadonlySemanticMarkup.js'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { listTexts } from './storage/textRepository'
import { getWordCount } from './domain/wordCount'
import './MyTexts.css'

function ArchiveRailHost({ textId, register }) {
  const ref = useCallback(node => register(textId, node), [textId, register])
  return <div className="archive-rail-host" ref={ref} />
}

function dateLabel(key) {
  return key.split('-').reverse().join('.')
}

export default function MyTexts({ userId, flush, onTotalWords, metadataHost, onMetadataSaved }) {
  const [records, setRecords] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [failed, setFailed] = useState(false)
  const [metadataLayout, setMetadataLayout] = useState(null)
  const [railHosts, setRailHosts] = useState({})
  const registerHost = useCallback((id, node) => setRailHosts(previous => previous[id] === node ? previous : { ...previous, [id]: node }), [])
  const handleSaved = useCallback(async (saved, previous) => {
    setRecords(items => items.map(item => item.textId === saved.textId ? saved : item))
    await onMetadataSaved?.(saved, previous)
  }, [onMetadataSaved])
  const pendingWrites = useRef(flush)
  const scrollArea = useRef(null)
  const [scrollElement, setScrollElement] = useState(null)
  const setScrollArea = useCallback(node => { scrollArea.current = node; setScrollElement(node) }, [])
  const positioned = useRef(false)
  const pendingExpansion = useRef(null)
  const [hasOpened, setHasOpened] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    pendingWrites.current().then(() => listTexts(userId)).then((items) => {
      if (!cancelled) {
        const ordered = [...items].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
        setRecords(ordered)
        onTotalWords(ordered.reduce((total, record) => total + getWordCount(record.content), 0))
      }
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [userId, onTotalWords])

  useLayoutEffect(() => {
    const area = scrollArea.current
    if (!area) return
    const measure = () => area.style.setProperty('--archive-height', `${area.clientHeight}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const area = scrollArea.current
    if (!area || !records?.length) return
    const openedId = pendingExpansion.current
    pendingExpansion.current = null
    if (openedId) {
      if (openedId === records[0].textId) {
        area.scrollTop = 0
      } else {
        const item = Array.from(area.querySelectorAll('[data-text-id]')).find((node) => node.dataset.textId === openedId)
        const content = item?.querySelector('.saved-text')
        if (content) {
          const lineHeight = parseFloat(getComputedStyle(content).lineHeight)
          const contextHeight = Math.min(lineHeight * 3, area.clientHeight / 3)
          area.scrollTop += content.getBoundingClientRect().top - area.getBoundingClientRect().top - contextHeight
        }
      }
      return
    }
    if (positioned.current) return
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const target = records.find((record) => record.dayKey === today) || records[records.length - 1]
    const item = Array.from(area.querySelectorAll('[data-text-id]')).find((node) => node.dataset.textId === target.textId)
    if (item) {
      area.scrollTop += item.getBoundingClientRect().top - area.getBoundingClientRect().top - area.clientHeight / 3
      positioned.current = true
    }
  }, [records, expanded])

  useLayoutEffect(() => {
    const area = scrollArea.current
    if (!area || !metadataHost || !records) return
    const alignMetadata = () => {
      const viewport = area.getBoundingClientRect()
      const host = metadataHost.getBoundingClientRect()
      setMetadataLayout({
        top: viewport.top - host.top, height: viewport.height,
        positions: Array.from(area.querySelectorAll('[data-text-id]')).map((item) => ({
          textId: item.dataset.textId, top: item.getBoundingClientRect().top - viewport.top,
        })),
      })
    }
    alignMetadata()
    area.addEventListener('scroll', alignMetadata, { passive: true })
    window.addEventListener('resize', alignMetadata)
    const observer = new ResizeObserver(alignMetadata)
    observer.observe(area)
    observer.observe(metadataHost)
    if (area.firstElementChild) observer.observe(area.firstElementChild)
    return () => {
      area.removeEventListener('scroll', alignMetadata)
      window.removeEventListener('resize', alignMetadata)
      observer.disconnect()
    }
  }, [records, expanded, metadataHost])

  const toggleRecord = (record) => {
    const opening = !expanded.has(record.textId)
    pendingExpansion.current = opening ? record.textId : null
    if (opening) setHasOpened(true)
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(record.textId)) next.delete(record.textId)
      else next.add(record.textId)
      return next
    })
  }

  return <><div className="editor-shell my-texts">
    <div className={`archive-scroll${hasOpened ? ' is-reading' : ''}`} ref={setScrollArea}>
      {failed ? <p role="alert">Не удалось прочитать сохранённые тексты.</p>
        : !records ? <p role="status">Загружаю…</p>
        : records.length ? <ul>
          {records.map((record) => <li key={record.textId} data-text-id={record.textId}>
            {!expanded.has(record.textId) ? <button type="button" aria-label={`Раскрыть текст за ${dateLabel(record.dayKey)}`} aria-expanded={false} onClick={() => toggleRecord(record)}>
              <span className="text-preview">{record.content.trim().replace(/\s+/g, ' ').slice(0, 240) || 'Текст пуст.'}</span>
            </button> : null}
            {expanded.has(record.textId) ? <>
              <button className="archive-record-info" type="button" aria-expanded aria-label={`Свернуть текст за ${dateLabel(record.dayKey)}`} onClick={() => toggleRecord(record)}>
                {dateLabel(record.dayKey)} · {getWordCount(record.content).toLocaleString('ru-RU')} слов
              </button>
              <div className="saved-text" aria-label="Сохранённый текст, только для чтения">
                <ArchiveWritingEntry record={record} metadataHost={railHosts[record.textId]} scrollElement={scrollElement} onSaved={handleSaved} />
              </div>
            </> : null}
          </li>)}
        </ul> : <p>Сохранённых текстов пока нет.</p>}
    </div>
  </div>
    {metadataHost && metadataLayout && records ? createPortal(
      <div className="archive-day-metadata" style={{ top: metadataLayout.top, height: metadataLayout.height }}>
        {records.map((record, index) => expanded.has(record.textId)
          ? <ArchiveRailHost key={record.textId} textId={record.textId} register={registerHost} />
          : <div
          key={record.textId}
          className="archive-day-label"
          style={{ top: metadataLayout.positions[index]?.top ?? 0 }}
        ><button
          type="button"
          aria-expanded={expanded.has(record.textId)}
          aria-label={`${expanded.has(record.textId) ? 'Свернуть' : 'Раскрыть'} текст за ${dateLabel(record.dayKey)}`}
          onClick={() => toggleRecord(record)}
        >
          <span>{dateLabel(record.dayKey)}</span>
          <span>{getWordCount(record.content).toLocaleString('ru-RU')} слов</span>
        </button>
          <ReadonlySemanticMarkup record={record} />
        </div>)}
      </div>, metadataHost,
    ) : null}
  </>
}
