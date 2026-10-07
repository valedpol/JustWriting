import { archiveDocument } from '../editor/archiveDocument.js'
import { parseDocument, documentToContent, CONTENT_FORMAT, CONTENT_VERSION } from '../editor/document.js'
import { parseSemanticMarkup } from '../editor/semanticSnapshot.js'
import { bytesHash } from '../utils/files.js'

const digest = text => bytesHash(new TextEncoder().encode(text))

// Coordinates are ProseMirror UTF-16 positions (v1), never trimmed text offsets.
export function canonicalArchiveRange(doc, range) {
  if (!range || !Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) ||
      range.from < 0 || range.to > doc.content.size || range.from >= range.to) throw new Error('Invalid source range')
  const from = range.from === 0 && doc.firstChild.isTextblock ? 1 : range.from
  const to = range.to === doc.content.size && doc.lastChild.isTextblock ? range.to - 1 : range.to
  if (from >= to) throw new Error('Empty source range')
  return { from, to }
}

// Map document positions to the original string, retaining CRLF/CR verbatim.
// Refuse inconsistent content/document rather than silently normalize content.
function contentOffsets(doc, content) {
  if (typeof content !== 'string' || content.replace(/\r\n?/g, '\n') !== documentToContent(doc.toJSON())) {
    throw new Error('Source content/document mismatch')
  }
  const normalizedOffsets = [0]
  for (let i = 0; i < content.length;) {
    i += content[i] === '\r' && content[i + 1] === '\n' ? 2 : 1
    normalizedOffsets.push(i)
  }
  const positions = new Map()
  let offset = 0
  doc.forEach((block, start, index) => {
    if (index) offset++ // documentToContent inserts one separator per block
    if (block.isTextblock) {
      positions.set(start + 1, offset)
      block.forEach((child, relative) => {
        const position = start + 1 + relative
        const length = child.isText ? child.text.length : child.type.name === 'hardBreak' ? 1 : 0
        for (let i = 0; i <= length; i++) positions.set(position + i, offset + i)
        offset += length
      })
      positions.set(start + block.nodeSize - 1, offset)
    } else {
      positions.set(start, offset)
      positions.set(start + block.nodeSize, offset)
    }
  })
  return position => {
    if (!positions.has(position)) throw new Error('Range must end at content boundaries')
    return normalizedOffsets[positions.get(position)]
  }
}

export function assertArchiveSource(userId, source, text, day) {
  if (source?.sourceType !== 'archive') throw new Error('Unsupported source type')
  if (typeof userId !== 'string' || !userId || typeof source.sourceId !== 'string' || !source.sourceId ||
      typeof source.archive?.userDayId !== 'string' || !source.archive.userDayId ||
      typeof source.archive?.dayKey !== 'string' || !source.archive.dayKey) throw new Error('Invalid source identity')
  if (source.coordinateVersion !== 1) throw new Error('Unsupported source coordinates')
  if (!Number.isSafeInteger(source.sourceRevision) || source.sourceRevision < 0) throw new Error('Invalid source revision')
  if (!text || text.userId !== userId || text.textId !== source.sourceId || !day || day.userId !== userId ||
      day.userDayId !== text.userDayId || day.dayKey !== text.dayKey ||
      source.archive?.userDayId !== day.userDayId || source.archive?.dayKey !== day.dayKey) throw new Error('Source owner/identity mismatch')
  if (text.revision !== source.sourceRevision) throw new Error('Source revision conflict')
}

export function archiveSourceFingerprint(text, day) {
  return JSON.stringify([text.textId, text.userId, text.userDayId, text.dayKey, text.revision, text.content,
    archiveDocument(text), text.semanticMarkup ?? [], day.userDayId, day.userId, day.dayKey, day.revision])
}

export async function prepareArchiveSnapshot(userId, source, text, day) {
  assertArchiveSource(userId, source, text, day)
  const document = archiveDocument(text), doc = parseDocument(document)
  const range = canonicalArchiveRange(doc, source.range)
  const offset = contentOffsets(doc, text.content)
  const content = text.content.slice(offset(range.from), offset(range.to))
  if (!content.length) throw new Error('Empty publication text')
  const fragment = doc.slice(range.from, range.to, true).content
  const snapshotDocument = parseDocument({ type: 'doc', content: fragment.toJSON() }).toJSON()
  if (documentToContent(snapshotDocument) !== content.replace(/\r\n?/g, '\n')) throw new Error('Snapshot content/document mismatch')
  const titles = new Set(parseSemanticMarkup(text.semanticMarkup ?? [], doc.content.size)
    .filter(item => item.kind === 'title' && item.range &&
      canonicalArchiveRange(doc, item.range).from === range.from && canonicalArchiveRange(doc, item.range).to === range.to)
    .map(item => item.value))
  return {
    fingerprint: archiveSourceFingerprint(text, day),
    source: { sourceType: 'archive', sourceId: text.textId, sourceRevision: text.revision, coordinateVersion: 1, range,
      contentSha256: await digest(text.content), documentSha256: await digest(JSON.stringify(document)),
      archive: { userDayId: day.userDayId, dayKey: day.dayKey } },
    snapshot: { content, document: snapshotDocument, contentFormat: CONTENT_FORMAT, contentVersion: CONTENT_VERSION,
      ...(titles.size === 1 ? { title: [...titles][0] } : {}) },
  }
}
