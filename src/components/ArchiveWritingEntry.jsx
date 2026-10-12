import { registerBackupFlush } from '../backup/backup.js'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import WritingEditor from './WritingEditor.jsx'
import ReadonlyDocument from './ReadonlyDocument.js'
import { createArchiveController } from '../editor/archiveController.js'
import { coversWholeText } from '../editor/nativeSelection.js'
import { getSemanticMarkup } from '../editor/semanticHistory.js'
import { TextSelection } from '@tiptap/pm/state'
import { focusView } from '../editor/focusView.js'

const ArchiveWritingEntry = forwardRef(function ArchiveWritingEntry({ record, metadataHost, scrollElement, onSaved, searchOccurrences, activeSearchId, layoutRevision, active = true }, ref) {
  const editor = useRef(null)
  const fallback = useRef(null)
  const [loaded] = useState(() => {
    try { return { controller: createArchiveController(record, { onSaved }) } }
    catch { return { error: true } }
  })
  useEffect(() => loaded.controller ? registerBackupFlush(() => loaded.controller.flush()) : undefined, [loaded])
  useImperativeHandle(ref, () => ({ flush: () => loaded.controller?.flush() ?? Promise.resolve(),
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
  } }), [loaded])
  if (loaded.error) return <div ref={fallback}><ReadonlyDocument record={record} /></div>
  return <div className="archive-writing-entry">
    <WritingEditor ref={editor} controller={loaded.controller} active={active} writing ready readonlyContent
      searchOccurrences={searchOccurrences} activeSearchId={activeSearchId} layoutRevision={layoutRevision}
      metadataHost={metadataHost} scrollElement={scrollElement} />
  </div>
})

export default ArchiveWritingEntry
