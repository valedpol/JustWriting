import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { revealDaySearchMatch } from '../editor/currentDaySearch.js'
import { useWritingToolPosition } from '../hooks/useWritingToolPosition.js'
import './DaySearch.css'

export default function DaySearch({ query, onQuery, occurrences, activeId, navigationRevision, onMove, onClose, anchor, metadataHost, view, scroller, onElement }) {
  const input = useRef(null)
  const position = useWritingToolPosition(anchor, metadataHost)
  const index = occurrences.findIndex(item => item.id === activeId)
  const positioned = Boolean(position)
  useEffect(() => { if (positioned) input.current?.focus() }, [positioned])
  useEffect(() => {
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', escape, true)
    return () => document.removeEventListener('keydown', escape, true)
  }, [onClose])
  useEffect(() => {
    if (!activeId || !view) return
    // PM decorations and React rail labels must both finish rendering first.
    const frame = requestAnimationFrame(() => {
      const elements = [...view.dom.querySelectorAll('[data-search-occurrence]'), ...(metadataHost?.querySelectorAll('[data-search-occurrence]') ?? [])]
      revealDaySearchMatch(elements.find(element => element.dataset.searchOccurrence === activeId), scroller, metadataHost)
    })
    return () => cancelAnimationFrame(frame)
  }, [activeId, query, navigationRevision, view, scroller, metadataHost])
  return position ? createPortal(<div ref={onElement} id="quick-day-search" className="day-search" data-writing-tools role="search" aria-label="Поиск по текущему дню"
    style={{ left: position.left, top: position.top, width: position.width }} onClick={event => event.stopPropagation()}>
    <div className="archive-search-form"><input ref={input} aria-label="Найти в текущем дне" value={query} onChange={event => onQuery(event.target.value)} /></div>
    <div className="archive-search-paging" aria-live="polite">
      <button type="button" aria-label="Предыдущее совпадение" disabled={!occurrences.length} onMouseDown={event => event.preventDefault()} onClick={() => onMove(-1)}>‹</button>
      <span>{occurrences.length ? `${index + 1} / ${occurrences.length}` : '0'}</span>
      <button type="button" aria-label="Следующее совпадение" disabled={!occurrences.length} onMouseDown={event => event.preventDefault()} onClick={() => onMove(1)}>›</button>
    </div>
  </div>, document.body) : null
}
