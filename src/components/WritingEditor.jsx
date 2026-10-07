import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorView } from '@tiptap/pm/view'
import { AllSelection, Selection, TextSelection } from '@tiptap/pm/state'
import { undo, redo } from '@tiptap/pm/history'
import { firstTextHasMark, toggleFirstTextMark } from '../editor/formatting.js'
import { assertArchiveTransaction } from '../editor/archivePresentation.js'
import { ReplaceStep } from '@tiptap/pm/transform'
import { focusView } from '../editor/focusView.js'
import { coversWholeText } from '../editor/nativeSelection.js'
import { cleanPaste } from '../editor/paste.js'
import { assignSelectionMarkup, confirmSlashMarkup, getSemanticMarkup, trackSemanticTransaction } from '../editor/semanticHistory.js'
import { listTexts } from '../storage/textRepository.js'
import { semanticSuggestions } from '../editor/semanticSuggestions.js'
import SemanticRail from './SemanticRail.jsx'
import SemanticPicker, { SemanticCategories } from './SemanticPicker.jsx'
import { searchDecorations } from '../editor/searchDecorations.js'
import { stickySelectionPanelTop } from '../editor/selectionPanelGeometry.js'
import { useArchivePublications } from '../hooks/useArchivePublications.js'
import { canonicalArchiveRange } from '../publications/archiveSource.js'
import PublicationPicker from './PublicationPicker.jsx'
import './WritingEditor.css'

const WritingEditor = forwardRef(function WritingEditor(props, ref) {
  const { controller, active, writing, ready, metadataHost, readonlyContent = false, scrollElement } = props
  const publications = useArchivePublications(controller, readonlyContent)
  const latest = useRef(props)
  useLayoutEffect(() => { latest.current = props })
  const host = useRef(null)
  const viewRef = useRef(null)
  const [runtime, setRuntime] = useState(null)
  const queryInput = useRef(null)
  const toolbarRef = useRef(null)
  const panelRef = useRef(null)
  const [panel, setPanelState] = useState(null)
  const [records, setRecords] = useState([])
  const [tick, setTick] = useState(0)
  const [position, setPosition] = useState(null)
  const [message, setMessage] = useState('')
  const [focused, setFocused] = useState(false)
  const [nativeSelected, setNativeSelected] = useState(null)
  const pointerSelection = useRef({ active: false, id: null, releaseTimer: null })
  const [pointerSelecting, setPointerSelecting] = useState(false)
  const panelOpen = Boolean(panel)
  const categoryOpen = Boolean(panel?.category)
  const ime = useRef({ timer: null, ending: false, acceptedAt: null })
  const setPanel = useCallback(value => { panelRef.current = value; setPanelState(value) }, [])
  const refresh = useCallback(() => setTick(value => value + 1), [])
  const report = useCallback(error => setMessage(error.message), [])
  const finishIME = useCallback(() => {
    clearTimeout(ime.current.timer)
    if (!controller?.composing) return
    // Flush the final browser mutation before closing the operation. This is
    // the only integration point using the view's internal DOM observer.
    viewRef.current?.domObserver.forceFlush()
    ime.current.ending = false
    controller.finishComposition(ime.current.acceptedAt ?? Date.now()).catch(report)
    ime.current.acceptedAt = null
  }, [controller, report])
  const scheduleIME = useCallback(() => {
    clearTimeout(ime.current.timer)
    ime.current.timer = setTimeout(finishIME, 30)
  }, [finishIME])
  const cancelPanel = useCallback((focus = false) => {
    setPanel(null)
    if (viewRef.current && controller) viewRef.current.updateState(controller.state)
    if (focus) { if (readonlyContent) focusView(viewRef.current); else viewRef.current?.focus() }
    refresh()
  }, [controller, refresh, setPanel, readonlyContent])

  useImperativeHandle(ref, () => ({
    get instance() { return viewRef.current },
    selectAll() {
      const view = viewRef.current
      if (!view) return
      view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
      focusView(view)
    },
    toggleSelectAll() {
      const view = viewRef.current
      if (!view) return
      const clear = coversWholeText(view.dom, view.dom.ownerDocument.getSelection())
      cancelPanel()
      view.dispatch(view.state.tr.setSelection(clear ? Selection.atStart(view.state.doc) : new AllSelection(view.state.doc)))
      focusView(view)
      setNativeSelected(!clear)
    },
    focus(end = false) {
      const view = viewRef.current
      if (!view) return
      if (panelRef.current?.category && !end) { queryInput.current?.focus(); return }
      if (end && panelRef.current) cancelPanel()
      if (end) view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
      view.focus()
    },
    finishComposition: finishIME,
    cancelPanel: () => cancelPanel(),
  }))

  useLayoutEffect(() => {
    if (!controller) return
    const compositionState = ime.current
    const view = new EditorView(host.current, {
      state: controller.state,
      editable: () => !latest.current.readonlyContent && latest.current.ready && latest.current.active && latest.current.writing && !panelRef.current?.category,
      attributes: { role: 'textbox', 'aria-label': 'Текстовый редактор', 'aria-multiline': 'true', spellcheck: 'true', autocorrect: 'off', autocapitalize: 'off', 'data-placeholder': 'Пиши просто. Просто пиши.', ...(readonlyContent ? { 'aria-readonly': 'true', tabindex: '0' } : {}) },
      decorations: state => searchDecorations(state.doc, latest.current.searchOccurrences, latest.current.activeSearchId),
      transformPastedHTML: cleanPaste,
      dispatchTransaction(tr) {
        if (panelRef.current?.category) return
        if (latest.current.readonlyContent) {
          try { assertArchiveTransaction(tr, getSemanticMarkup(controller.state)) }
          catch (error) { report(error); view.updateState(controller.state); return }
        }
        const kind = tr.getMeta('uiEvent') === 'paste' ? 'paste' : tr.getMeta('jwSemanticCommand') ? 'semantic' : 'input'
        const step = tr.steps.length === 1 && tr.steps[0] instanceof ReplaceStep ? tr.steps[0] : null
        const slash = !controller.composing && kind === 'input' && step?.slice.size === 1 && step.slice.content.textBetween(0, step.slice.content.size) === '/'
        if (panelRef.current && (tr.docChanged || tr.selectionSet)) setPanel(null)
        try {
          controller.dispatch(tr, kind).catch(report)
          if (slash) setPanel({ source: 'slash', from: step.from, category: null, query: '' })
          if (ime.current.ending) scheduleIME()
        } catch (error) { report(error); view.updateState(controller.state) }
      },
      handleDOMEvents: {
        keydown(_view, event) {
          // Readonly DOM never receives the ordinary text-editing keymap.
          if (latest.current.readonlyContent && (event.metaKey || event.ctrlKey) && !event.altKey) {
            const key = event.key.toLowerCase()
            const mark = { b: 'bold', i: 'italic', u: 'underline' }[key]
            const run = mark && !event.shiftKey ? toggleFirstTextMark(controller.state.schema.marks[mark])
              : key === 'z' ? event.shiftKey ? redo : undo : key === 'y' && !event.shiftKey ? redo : null
            if (run) {
              event.preventDefault()
              if (controller.snapshot.writable && controller.snapshot.canChangePresentation !== false) {
                try { run(controller.state, tr => controller.dispatch(trackSemanticTransaction(controller.state, tr, { scrollIntoView: false })).catch(report)) }
                catch (error) { report(error) }
              }
              return true
            }
          }
          if (!latest.current.readonlyContent && !latest.current.writing && latest.current.active && latest.current.ready && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing) {
            event.preventDefault()
            latest.current.onActivate()
            controller.dispatch(view.state.tr.insertText(event.key)).catch(report)
            return true
          }
          return false
        },
        compositionstart() {
          if (latest.current.readonlyContent || !latest.current.writing || !latest.current.ready) return false
          if (ime.current.ending) finishIME()
          cancelPanel()
          controller.beginComposition()
          return false
        },
        compositionend() {
          if (controller.composing) {
            ime.current.ending = true; ime.current.acceptedAt = Date.now(); scheduleIME()
          }
          return false
        },
        input() {
          if (ime.current.ending) { ime.current.acceptedAt = Date.now(); scheduleIME() }
          return false
        },
        beforeinput(_view, event) {
          if (ime.current.ending && !event.isComposing && !/Composition/.test(event.inputType ?? '')) finishIME()
          return false
        },
        mousedown() {
          if (panelRef.current?.category) cancelPanel()
          return false
        },
        blur() {
          if (!panelRef.current?.category) cancelPanel()
          if (controller.composing) { ime.current.ending = true; ime.current.acceptedAt = Date.now(); scheduleIME() }
          setFocused(false); refresh()
          return false
        },
        focus() { setFocused(true); refresh(); return false },
      },
      handleClick() {
        if (!latest.current.readonlyContent && latest.current.active && latest.current.ready && !latest.current.writing) latest.current.onActivate()
        refresh()
        return false
      },
      handleKeyDown(_view, event) {
        if (event.key === 'Escape' && panelRef.current) { cancelPanel(true); return true }
        return false
      },
    })
    viewRef.current = view
    const gesture = pointerSelection.current
    const ownerDocument = view.dom.ownerDocument
    const selectionChanged = () => {
      // Intermediate browser ranges (including a temporary range outside this
      // day) are not a completed selection. Never collapse them during drag.
      if (gesture.active) return
      // Focusing the picker is a panel interaction, not deselecting the text.
      if (panelRef.current?.category && toolbarRef.current?.contains(ownerDocument.activeElement)) return
      const selection = ownerDocument.getSelection()
      const selected = Boolean(selection && !selection.isCollapsed && view.dom.contains(selection.anchorNode) && view.dom.contains(selection.focusNode))
      setNativeSelected(selected)
      if (!selected && panelRef.current?.source === 'selection') cancelPanel()
      if (!selected && latest.current.readonlyContent && !controller.state.selection.empty) {
        let position = controller.state.selection.from
        if (selection?.anchorNode && view.dom.contains(selection.anchorNode)) {
          try { position = view.posAtDOM(selection.anchorNode, selection.anchorOffset) } catch { /* use previous boundary */ }
        }
        controller.dispatch(controller.state.tr.setSelection(Selection.near(controller.state.doc.resolve(position)))).catch(report)
      }
    }
    const beginPointerSelection = event => {
      if (event.button !== 0 || event.isPrimary === false || !view.dom.contains(event.target)) return
      if (gesture.active) return // pointerdown followed by compatibility mousedown
      clearTimeout(gesture.releaseTimer)
      gesture.active = true
      gesture.id = event.pointerId ?? null
      setPointerSelecting(true)
    }
    const finishPointerSelection = event => {
      if (!gesture.active || (event.pointerId != null && gesture.id != null && event.pointerId !== gesture.id)) return
      clearTimeout(gesture.releaseTimer)
      // Let browser/ProseMirror mouseup handlers finish before reading the range.
      gesture.releaseTimer = setTimeout(() => {
        gesture.releaseTimer = null
        gesture.active = false
        gesture.id = null
        const selection = ownerDocument.getSelection()
        if (latest.current.readonlyContent && selection && !selection.isCollapsed &&
          view.dom.contains(selection.anchorNode) && view.dom.contains(selection.focusNode)) {
          try {
            const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset)
            const head = view.posAtDOM(selection.focusNode, selection.focusOffset)
            const finalSelection = TextSelection.between(view.state.doc.resolve(anchor), view.state.doc.resolve(head))
            if (!finalSelection.eq(controller.state.selection)) {
              view.dispatch(controller.state.tr.setSelection(finalSelection))
            }
          } catch { /* A removed range will be handled by selectionChanged below. */ }
        }
        selectionChanged()
        setPointerSelecting(false)
        refresh()
      }, 0)
    }
    ownerDocument.addEventListener('pointerdown', beginPointerSelection, true)
    ownerDocument.addEventListener('mousedown', beginPointerSelection, true)
    ownerDocument.addEventListener('pointerup', finishPointerSelection, true)
    ownerDocument.addEventListener('mouseup', finishPointerSelection, true)
    ownerDocument.addEventListener('pointercancel', finishPointerSelection, true)
    ownerDocument.defaultView.addEventListener('blur', finishPointerSelection)
    view.dom.ownerDocument.addEventListener('selectionchange', selectionChanged)
    setRuntime({ view, scroller: host.current.parentElement })
    const unsubscribe = controller.subscribe(snapshot => {
      const pending = panelRef.current
      if (pending?.category && (pending.base !== snapshot.state || !snapshot.writable)) {
        setPanel(null)
        if (pending.query?.trim()) controller.keepDraft({ kind: pending.category, value: pending.query })
      }
      view.updateState(panelRef.current?.preview ?? snapshot.state)
      refresh()
    })
    return () => {
      clearTimeout(compositionState.timer); unsubscribe()
      clearTimeout(gesture.releaseTimer)
      gesture.active = false
      gesture.id = null
      ownerDocument.removeEventListener('pointerdown', beginPointerSelection, true)
      ownerDocument.removeEventListener('mousedown', beginPointerSelection, true)
      ownerDocument.removeEventListener('pointerup', finishPointerSelection, true)
      ownerDocument.removeEventListener('mouseup', finishPointerSelection, true)
      ownerDocument.removeEventListener('pointercancel', finishPointerSelection, true)
      ownerDocument.defaultView.removeEventListener('blur', finishPointerSelection)
      view.dom.ownerDocument.removeEventListener('selectionchange', selectionChanged)
      view.destroy(); viewRef.current = null
    }
  }, [controller, cancelPanel, finishIME, scheduleIME, refresh, report, setPanel, readonlyContent])

  useLayoutEffect(() => {
    viewRef.current?.setProps({ editable: () => !readonlyContent && ready && active && writing && !panelRef.current?.category })
  }, [active, writing, ready, categoryOpen, readonlyContent])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (view && readonlyContent) view.setProps({ decorations: state => searchDecorations(state.doc, latest.current.searchOccurrences, latest.current.activeSearchId) })
  }, [props.searchOccurrences, props.activeSearchId, readonlyContent])

  useEffect(() => {
    if (!panelOpen || !controller) return
    let cancelled = false
    listTexts(controller.snapshot.context.userId).then(items => { if (!cancelled) setRecords(items) }).catch(report)
    return () => { cancelled = true }
  }, [panelOpen, controller, report])
  useEffect(() => { if (panel?.category) queryInput.current?.focus() }, [panel?.category])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view || !active) return
    const measure = () => {
      if (pointerSelection.current.active) return
      try {
        const from = panelRef.current?.from ?? view.state.selection.from
        const coords = view.coordsAtPos(Math.min(from, view.state.doc.content.size))
        setPosition({ x: Math.max(190, Math.min(window.innerWidth - 190, coords.left)), y: Math.max(8, Math.min(window.innerHeight - (panelRef.current?.category ? 280 : 55), coords.bottom + 8)) })
      } catch { setPosition(null) }
    }
    measure()
    const scroller = scrollElement ?? host.current?.parentElement
    scroller?.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(host.current)
    if (scroller) observer.observe(scroller)
    return () => { scroller?.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); observer.disconnect() }
  }, [tick, active, writing, metadataHost, panelOpen, controller, scrollElement, pointerSelecting, props.layoutRevision])

  const choosePublication = () => {
    try {
      const state = controller.state, record = controller.snapshot.record
      const range = canonicalArchiveRange(state.doc, state.selection)
      setPanel({ source: 'selection', from: state.selection.from, category: 'publication', base: state,
        publicationSource: { sourceType: 'archive', sourceId: record.textId, sourceRevision: record.revision, coordinateVersion: 1, range,
          archive: { userDayId: record.userDayId, dayKey: record.dayKey } } })
      publications.reload().catch(() => {})
    } catch (error) { report(error) }
  }
  const chooseCategory = category => {
    const state = controller.state
    const pending = panelRef.current ?? { source: 'selection', from: state.selection.from }
    let preview = null
    if (pending.source === 'slash') preview = state.applyTransaction(trackSemanticTransaction(state, state.tr.delete(pending.from, pending.from + 1))).state
    const next = { ...pending, category, query: pending.query ?? '', base: state, preview }
    setPanel(next)
    if (preview) viewRef.current.updateState(preview)
  }
  const applyValue = value => {
    const pending = panelRef.current
    if (!pending?.category || !value.value.trim()) return
    const attributes = { id: crypto.randomUUID(), kind: pending.category, valueId: value.valueId ?? crypto.randomUUID(), value: value.value.trim(), assignedAt: Date.now() }
    try {
      const tr = pending.source === 'slash' ? confirmSlashMarkup(pending.base, pending.from, attributes) : assignSelectionMarkup(pending.base, attributes)
      setPanel(null); viewRef.current.updateState(controller.state)
      controller.dispatch(tr, pending.source === 'slash' ? 'slash-markup' : 'selection-markup').catch(report)
      focusView(viewRef.current)
    } catch (error) { report(error) }
  }
  const command = run => {
    try {
      run(controller.state, tr => controller.dispatch(
        trackSemanticTransaction(controller.state, tr, { scrollIntoView: false }), 'format',
      ).catch(report))
      focusView(viewRef.current)
    }
    catch (error) { report(error) }
  }
  const state = controller?.state
  const suggestions = panel?.category && panel.category !== 'publication' && controller ? semanticSuggestions([
    ...records.filter(record => record.textId !== controller.snapshot.record?.textId),
    { userId: controller.snapshot.context.userId, semanticMarkup: getSemanticMarkup(state) },
  ], controller.snapshot.context.userId, panel.category, panel.query) : []
  const selected = state && !state.selection.empty && firstTextHasMark(state, state.schema.marks.bold) !== null
  const canChangePresentation = controller?.snapshot.canChangePresentation !== false && controller?.snapshot.writable
  const panelVisible = !pointerSelecting && canChangePresentation && active && writing && ready && position && (panel || (selected && focused && nativeSelected !== false))
  useLayoutEffect(() => {
    const element = toolbarRef.current
    const view = viewRef.current
    // Only the selection toolbar. Slash and category panels keep their geometry.
    if (!panelVisible || (panel && panel.category !== 'publication') || !element || !view) return
    const place = () => {
      if (pointerSelection.current.active) return
      const selectionTop = view.coordsAtPos(view.state.selection.from, 1).top
      const panelHeight = element.getBoundingClientRect().height
      // Archive toolbar stops inside its bounded viewport; other editors
      // retain their existing position above the first selected line.
      const top = selectionTop - panelHeight
      const viewportTop = readonlyContent && scrollElement ? scrollElement.getBoundingClientRect().top : null
      let panelTop = top
      if (viewportTop !== null && top < viewportTop + 8) {
        const archive = scrollElement.closest('.my-texts')
        const boundary = archive?.querySelector('#archive-calendar .research-time')
          ?? archive?.querySelector('.archive-calendar-heading')
        const boundaryBottom = boundary?.getBoundingClientRect().bottom ?? viewportTop
        const selection = view.dom.ownerDocument.getSelection()
        const viewportBottom = scrollElement.getBoundingClientRect().bottom
        const lines = selection?.rangeCount && view.dom.contains(selection.anchorNode) && view.dom.contains(selection.focusNode)
          ? [...selection.getRangeAt(0).getClientRects()].filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom > viewportTop && rect.top < viewportBottom)
          : []
        const firstVisibleTop = lines.length ? Math.max(viewportTop, Math.min(...lines.map(rect => rect.top))) : Infinity
        panelTop = stickySelectionPanelTop(boundaryBottom, firstVisibleTop, panelHeight)
      }
      element.style.top = `${panelTop}px`
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(element)
    return () => observer.disconnect()
  }, [panelVisible, panel, position, tick, writing, readonlyContent, scrollElement])
  return <>
    <div className="writing-scroll"><div ref={host} className="writing-editor" onClick={event => event.stopPropagation()} /></div>
    {message && active ? <p className="editor-message" role="alert">{message}<button onClick={() => setMessage('')}>Закрыть</button></p> : null}
    {panelVisible ? createPortal(<div ref={toolbarRef} className="editor-panel" data-writing-tools role="toolbar" aria-label="Разметка текста"
      style={{ left: position.x, top: position.y }} onClick={event => event.stopPropagation()}
      onBlur={event => { if (panelRef.current?.category && !event.currentTarget.contains(event.relatedTarget)) cancelPanel() }}>
      <div className="editor-panel-row" onMouseDown={event => event.preventDefault()}>
        {(!panel || panel.source === 'selection') ? <>
          {['bold', 'italic', 'underline'].map((mark, i) => <button key={mark} aria-label={['Жирный', 'Курсив', 'Подчёркнутый'][i]}
            aria-pressed={firstTextHasMark(state, state.schema.marks[mark]) === true}
            onClick={() => command(toggleFirstTextMark(state.schema.marks[mark]))}>{['B', 'I', 'U'][i]}</button>)}<span aria-hidden="true">|</span>
        </> : null}
        <SemanticCategories panel={panel} chooseCategory={chooseCategory} />
        {readonlyContent && selected && controller.snapshot.record?.userDayId ? <button aria-expanded={panel?.category === 'publication'}
          onClick={choosePublication}>Опубликовать</button> : null}
      </div>
      {panel?.category === 'publication' ? <PublicationPicker source={panel.publicationSource} records={publications.records}
        loading={publications.loading} loadError={publications.error} canCreate={canChangePresentation && panel.base === state}
        create={publications.create} close={() => cancelPanel(true)} /> : <SemanticPicker panel={panel} queryInput={queryInput} suggestions={suggestions} setPanel={setPanel}
        applyValue={applyValue} cancelPanel={cancelPanel} />}
    </div>, document.body) : null}
    <SemanticRail view={runtime?.view} controller={controller} active={active} writing={writing} ready={ready}
      metadataHost={metadataHost} scrollElement={scrollElement ?? runtime?.scroller} tick={tick}
      publications={readonlyContent ? publications.records : undefined}
      searchOccurrences={props.searchOccurrences} activeSearchId={props.activeSearchId}
      onActivate={props.onActivate} report={report} allowChanges={!readonlyContent && canChangePresentation} allowRemoval={canChangePresentation} />
  </>
})

export default WritingEditor
