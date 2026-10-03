import { registerBackupFlush } from '../backup/backup.js'
import { useEffect, useState } from 'react'
import WritingEditor from './WritingEditor.jsx'
import ReadonlyDocument from './ReadonlyDocument.js'
import { createArchiveController } from '../editor/archiveController.js'

export default function ArchiveWritingEntry({ record, metadataHost, scrollElement, onSaved }) {
  const [loaded] = useState(() => {
    try { return { controller: createArchiveController(record, { onSaved }) } }
    catch { return { error: true } }
  })
  useEffect(() => loaded.controller ? registerBackupFlush(() => loaded.controller.flush()) : undefined, [loaded])
  if (loaded.error) return <ReadonlyDocument record={record} />
  return <div className="archive-writing-entry">
    <WritingEditor controller={loaded.controller} active writing ready readonlyContent
      metadataHost={metadataHost} scrollElement={scrollElement} />
  </div>
}
