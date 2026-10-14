import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { focusView } from '../editor/focusView.js'
import PublicationMarker from './PublicationMarker.jsx'
import { attachedLiveRange } from '../publications/liveAnchors.js'
import { canonicalArchiveRange } from '../publications/archiveSource.js'
import { archiveDocument } from '../editor/archiveDocument.js'
import { parseDocument } from '../editor/document.js'
import SearchHighlights from './SearchHighlights.jsx'
import { TextSelection } from '@tiptap/pm/state'
import { getSemanticMarkup, removeSemanticMarkup, setSemanticRange } from '../editor/semanticHistory.js'

const noPublications = []
const labels = { tag: 'Тег', title: 'Название' }

export default function SemanticRail({ view, controller, active, writing, ready, metadataHost, scrollElement, tick, onActivate, report, allowChanges = true, allowRemoval = allowChanges, searchOccurrences = [], activeSearchId, publications = noPublications, highlightedPublicationId, onHighlightPublication, onRemovePublication, obstruction = null, visibleRange }) {
  const railRef = useRef(null)
  const [rail, setRail] = useState([])
  const state = controller?.state
  const record = controller?.snapshot.record
  useLayoutEffect(() => {
    if (!view || !active || !metadataHost) return
    const measure = () => {
      const bounds = metadataHost.getBoundingClientRect()
      const groups = new Map()
      const markup = getSemanticMarkup(view.state).sort((a, b) => a.anchor - b.anchor)
      const titles = new Map()
      for (const item of markup) {
        if (visibleRange && (item.range ? item.range.from < visibleRange.from || item.range.to > visibleRange.to : item.anchor < visibleRange.from || item.anchor > visibleRange.to)) continue
        if (item.kind === 'title' && item.range) {
          // Structural-only legacy ranges have no canonical text range.
          // Keep their independent semantic label, without associating a marker.
          let range
          try { range = canonicalArchiveRange(view.state.doc, item.range) } catch { range = null }
          if (range) {
            const key = `${range.from}:${range.to}`
            if (!titles.has(key)) titles.set(key, new Set())
            titles.get(key).add(item.value)
          }
        }
        const key = item.kind === 'tag' && item.source === 'selection' && item.range
          ? `range:${item.range.from}:${item.range.to}` : `item:${item.id}`
        if (groups.has(key)) groups.get(key).items.push(item)
        else groups.set(key, { key, items: [item] })
      }
      for (const publication of publications) {
        if (publication.source.sourceId !== record?.textId) continue
        // During an optimistic edit/IME the persisted anchor belongs to the
        // saved document, not the preedit preview. Never display stale positions.
        if (!view.state.doc.eq(parseDocument(archiveDocument(record)))) continue
        const range = attachedLiveRange(publication, record?.revision)
        if (visibleRange && range && (range.from < visibleRange.from || range.to > visibleRange.to)) continue
        if (!range || range.from < 1 || range.from >= range.to || range.to >= view.state.doc.content.size) continue
        const key = `publication-range:${range.from}:${range.to}`
        const exactTitles = titles.get(`${range.from}:${range.to}`)
        // Current exact-range association only. The immutable snapshot title
        // may describe a different historical range and is never a fallback.
        const title = exactTitles?.size === 1 ? [...exactTitles][0] : undefined
        const item = { id: publication.publicationId, kind: 'publication', anchor: range.from, channel: publication.channel, title }
        if (groups.has(key)) groups.get(key).items.push(item)
        else groups.set(key, { key, items: [item] })
      }
      setRail([...groups.values()].map(group => {
        const item = group.items[0]
        const side = item.source === 'slash' && item.kind === 'tag' && item.range === null ? -1 : 1
        const y = view.coordsAtPos(item.anchor, side).top - bounds.top
        return { ...group, baseTop: y }
      }))
    }
    measure()
    scrollElement?.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(view.dom)
    observer.observe(metadataHost)
    return () => { scrollElement?.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); observer.disconnect() }
  }, [view, active, writing, metadataHost, scrollElement, tick, state, publications, record, visibleRange])
  useLayoutEffect(() => {
    // Measure after wrapping, so a tall group cannot overlap the next one.
    const groups = [...(railRef.current?.querySelectorAll('.semantic-group') ?? [])]
      .map((element, index) => ({ element, baseTop: rail[index].baseTop }))
      .sort((a, b) => a.baseTop - b.baseTop)
    const placeGroups = () => {
      // The quick-search controls occupy only the right information area.
      // Extend existing collision avoidance so labels cannot hide behind them.
      let previousBottom = obstruction ? obstruction.getBoundingClientRect().bottom - metadataHost.getBoundingClientRect().top + 8 : -Infinity
      groups.forEach(({ element, baseTop }) => {
        const height = element.getBoundingClientRect().height
        if (obstruction && baseTop + height <= 0) {
          // Scrolled-out labels must still disappear, not accumulate below search.
          element.style.top = `${baseTop}px`
          return
        }
        const top = Math.max(baseTop, previousBottom)
        element.style.top = `${top}px`
        previousBottom = top + height
      })
    }
    placeGroups()
    const observer = new ResizeObserver(placeGroups)
    groups.forEach(({ element }) => observer.observe(element))
    if (obstruction) observer.observe(obstruction)
    return () => observer.disconnect()
  }, [rail, metadataHost, obstruction])

  return <>
    {metadataHost && controller && active ? createPortal(<div ref={railRef} className="semantic-rail" aria-label="Системная разметка">
      {rail.map(group => <div className="semantic-group" key={group.key} style={{ top: group.baseTop }}>
        {group.items.map(item => item.kind === 'publication' ? <PublicationMarker key={item.id} item={item} ready={ready}
          highlighted={highlightedPublicationId === item.id} onHighlight={onHighlightPublication} onRemove={onRemovePublication}
          canRemove={allowRemoval && !!onRemovePublication} report={report} /> : <div className="semantic-label" key={item.id}>
        <button className="semantic-value" data-kind={item.kind} disabled={!ready} title={item.range ? 'Выделить размеченный фрагмент' : 'Вторая граница ещё не задана'}
          onMouseDown={event => event.preventDefault()} onClick={event => {
            event.stopPropagation()
            if (!writing) onActivate()
            const from = item.range?.from ?? item.anchor; const to = item.range?.to ?? item.anchor
            controller.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)), 'selection').catch(report)
            if (allowChanges) view.focus(); else focusView(view)
          }}>{item.kind === 'tag' ? '#' : ''}<SearchHighlights value={item.value} occurrences={searchOccurrences.filter(match => match.markupId === item.id)} activeId={activeSearchId} /></button>
        {allowChanges && writing && ready && !item.range ? <button className="semantic-boundary" title={`Поставьте курсор ${item.direction === 'forward' ? 'после' : 'перед'} смысловой точкой и нажмите эту кнопку`}
          disabled={!state.selection.empty || (item.direction === 'forward' ? state.selection.from <= item.anchor : state.selection.from >= item.anchor)}
          onMouseDown={event => event.preventDefault()} onClick={event => {
            event.stopPropagation()
            const cursor = state.selection.from
            controller.dispatch(setSemanticRange(state, item.id, { from: Math.min(cursor, item.anchor), to: Math.max(cursor, item.anchor) }), 'semantic').catch(report)
            view.focus()
          }}>Граница здесь {item.direction === 'forward' ? '→' : '←'}</button> : null}
        {allowRemoval && writing && ready ? <button className="semantic-remove" aria-label={`Удалить разметку ${item.value}`} onMouseDown={event => event.preventDefault()} onClick={event => {
          event.stopPropagation(); controller.dispatch(removeSemanticMarkup(state, item.id), 'semantic').catch(report)
          if (allowChanges) view.focus(); else focusView(view)
        }}>×</button> : null}
        </div>)}
      </div>)}
      {controller.snapshot.drafts.map((draft, index) => <div className="semantic-draft" key={index}><span>{labels[draft.kind]}: {draft.value}</span><small>Черновик без привязки к тексту</small><button onClick={() => controller.dismissDraft(index)}>Закрыть</button></div>)}
    </div>, metadataHost) : null}
  </>
}
