import { registerBackupFlush } from '../backup/backup.js'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import WritingEditor from './WritingEditor.jsx'
import ReadonlyDocument from './ReadonlyDocument.js'
import { createArchiveController } from '../editor/archiveController.js'
import { coversWholeText } from '../editor/nativeSelection.js'
import { getSemanticMarkup } from '../editor/semanticHistory.js'
import { TextSelection } from '@tiptap/pm/state'
import { focusView } from '../editor/focusView.js'

const ArchiveWritingEntry = forwardRef(function ArchiveWritingEntry({ record, metadataHost, scrollElement, onSaved, searchOccurrences, activeSearchId, layoutRevision, visibleRange, contextRange, active = true }, ref) {
  const editor = useRef(null)
  const fallback = useRef(null)
  const [loaded] = useState(() => {
    try { return { controller: createArchiveController(record, { onSaved }) } }
    catch { return { error: true } }
  })
  useEffect(() => loaded.controller ? registerBackupFlush(() => loaded.controller.flush()) : undefined, [loaded])
  useImperativeHandle(ref, () => ({ flush: () => loaded.controller?.flush() ?? Promise.resolve(),
    locatePosition(position) {
      const view = editor.current?.instance
      return view ? view.coordsAtPos(Math.min(view.state.doc.content.size, Math.max(0, position)), 1) : null
    },
    viewportAnchor(range) {
      const view = editor.current?.instance
      if (!view || !scrollElement || !range) return null
      const viewport = scrollElement.getBoundingClientRect()
      const start = view.coordsAtPos(range.from, 1)
      // Keep a source-coordinate landmark even when its line is above the
      // viewport. Hit-testing a clipped paragraph can choose a different line.
      return { position: range.from, top: start.top - viewport.top }
    },
    locateSemantic(id) {
      const view = editor.current?.instance
      if (!view) return null
      const item = getSemanticMarkup(view.state).find(item => item.id === id)
      if (!item) return null
      const from = item.range?.from ?? item.anchor, to = item.range?.to ?? item.anchor
      // Same selection-only transaction as the existing semantic rail.
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
      focusView(view)
      return view.coordsAtPos(from, 1)
    }, toggleSelection() {
    if (editor.current) editor.current.toggleSelectAll()
    else if (fallback.current) {
      const range = document.createRange()
      range.selectNodeContents(fallback.current)
      const selection = window.getSelection()
      if (coversWholeText(fallback.current, selection)) { selection.removeAllRanges(); return }
      selection.removeAllRanges()
      selection.addRange(range)
    }
  } }), [loaded, scrollElement])
  if (loaded.error && visibleRange) return <p role="status">Не удалось отобразить именованный фрагмент.</p>
  if (loaded.error) return <div ref={fallback}><ReadonlyDocument record={record} /></div>
  return <div className="archive-writing-entry">
    <WritingEditor ref={editor} controller={loaded.controller} active={active} writing ready readonlyContent
      searchOccurrences={searchOccurrences} activeSearchId={activeSearchId} layoutRevision={layoutRevision}
      visibleRange={visibleRange} contextRange={contextRange}
      metadataHost={metadataHost} scrollElement={scrollElement} />
  </div>
})

export default ArchiveWritingEntry
