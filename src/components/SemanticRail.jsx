import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { focusView } from '../editor/focusView.js'
import { TextSelection } from '@tiptap/pm/state'
import { getSemanticMarkup, removeSemanticMarkup, setSemanticRange } from '../editor/semanticHistory.js'

const labels = { tag: 'Тег', title: 'Название' }

export default function SemanticRail({ view, controller, active, writing, ready, metadataHost, scrollElement, tick, onActivate, report, allowChanges = true, allowRemoval = allowChanges }) {
  const railRef = useRef(null)
  const [rail, setRail] = useState([])
  const state = controller?.state
  useLayoutEffect(() => {
    if (!view || !active || !metadataHost) return
    const measure = () => {
      const bounds = metadataHost.getBoundingClientRect()
      const groups = new Map()
      for (const item of getSemanticMarkup(view.state).sort((a, b) => a.anchor - b.anchor)) {
        const key = item.kind === 'tag' && item.source === 'selection' && item.range
          ? `range:${item.range.from}:${item.range.to}` : `item:${item.id}`
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
  }, [view, active, writing, metadataHost, scrollElement, tick, state])
  useLayoutEffect(() => {
    // Measure after wrapping, so a tall group cannot overlap the next one.
    let previousBottom = -Infinity
    const groups = [...(railRef.current?.querySelectorAll('.semantic-group') ?? [])]
      .map((element, index) => ({ element, baseTop: rail[index].baseTop }))
      .sort((a, b) => a.baseTop - b.baseTop)
    groups.forEach(({ element, baseTop }) => {
      const height = element.getBoundingClientRect().height
      const top = Math.max(baseTop, previousBottom)
      element.style.top = `${top}px`
      previousBottom = top + height
    })
  }, [rail, metadataHost])

  return <>
    {metadataHost && controller && active ? createPortal(<div ref={railRef} className="semantic-rail" aria-label="Системная разметка">
      {rail.map(group => <div className="semantic-group" key={group.key} style={{ top: group.baseTop }}>
        {group.items.map(item => <div className="semantic-label" key={item.id}>
        <button className="semantic-value" data-kind={item.kind} disabled={!ready} title={item.range ? 'Выделить размеченный фрагмент' : 'Вторая граница ещё не задана'}
          onMouseDown={event => event.preventDefault()} onClick={event => {
            event.stopPropagation()
            if (!writing) onActivate()
            const from = item.range?.from ?? item.anchor; const to = item.range?.to ?? item.anchor
            controller.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)), 'selection').catch(report)
            if (allowChanges) view.focus(); else focusView(view)
          }}>{item.kind === 'tag' ? '#' : ''}{item.value}</button>
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
