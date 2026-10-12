import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { archiveDocument } from './archiveDocument.js'
import { parseDocument } from './document.js'
import { attachedLiveRange } from '../publications/liveAnchors.js'

export function publicationDecorations(doc, record, publications = [], activeId) {
  const publication = publications.find(p => p.publicationId === activeId && p.source.sourceId === record?.textId && p.userId === record?.userId)
  const range = publication && attachedLiveRange(publication, record.revision)
  // Never use historical coordinates, or persisted coordinates on an unsaved doc.
  if (!range || range.from < 1 || range.to >= doc.content.size || range.from >= range.to ||
    !doc.eq(parseDocument(archiveDocument(record)))) return DecorationSet.empty
  return DecorationSet.create(doc, [Decoration.inline(range.from, range.to, { class: 'archive-publication-highlight' })])
}
