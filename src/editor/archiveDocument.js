import { CONTENT_FORMAT, CONTENT_VERSION, documentFromRecord, parseDocument } from './document.js'

// Legacy was displayed as literal pre-wrapped text. Keep every newline as a
// line break, without introducing paragraph margins when metadata is assigned.
export function archiveDocument(record) {
  if (record.contentFormat !== undefined) return documentFromRecord(record)
  const lines = record.content.replace(/\r\n?/g, '\n').split('\n')
  const content = []
  lines.forEach((text, index) => {
    if (index) content.push({ type: 'hardBreak' })
    if (text) content.push({ type: 'text', text })
  })
  return parseDocument({ type: 'doc', content: [{ type: 'paragraph', ...(content.length ? { content } : {}) }] }).toJSON()
}

export function archiveEditorRecord(record) {
  return { ...record, contentFormat: CONTENT_FORMAT, contentVersion: CONTENT_VERSION,
    document: archiveDocument(record), semanticMarkup: record.semanticMarkup ?? [] }
}
