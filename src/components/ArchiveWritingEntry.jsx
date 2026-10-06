import { registerBackupFlush } from '../backup/backup.js'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import WritingEditor from './WritingEditor.jsx'
import ReadonlyDocument from './ReadonlyDocument.js'
import { createArchiveController } from '../editor/archiveController.js'
import { coversWholeText } from '../editor/nativeSelection.js'

const ArchiveWritingEntry = forwardRef(function ArchiveWritingEntry({ record, metadataHost, scrollElement, onSaved, searchOccurrences, activeSearchId }, ref) {
  const editor = useRef(null)
  const fallback = useRef(null)
  const [loaded] = useState(() => {
    try { return { controller: createArchiveController(record, { onSaved }) } }
    catch { return { error: true } }
  })
  useEffect(() => loaded.controller ? registerBackupFlush(() => loaded.controller.flush()) : undefined, [loaded])
  useImperativeHandle(ref, () => ({ flush: () => loaded.controller?.flush() ?? Promise.resolve(), toggleSelection() {
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
    <WritingEditor ref={editor} controller={loaded.controller} active writing ready readonlyContent
      searchOccurrences={searchOccurrences} activeSearchId={activeSearchId}
      metadataHost={metadataHost} scrollElement={scrollElement} />
  </div>
})

export default ArchiveWritingEntry
