import { archiveDocument } from '../editor/archiveDocument.js'
import { parseDocument } from '../editor/document.js'
import { bytesHash } from '../utils/files.js'
import { canonicalArchiveRange, contentPositionMap } from './archiveSource.js'

const digest = value => bytesHash(new TextEncoder().encode(value))

export function exactSnapshotRanges(text, snapshot) {
  if (typeof snapshot !== 'string' || !snapshot.length) throw new Error('Empty snapshot')
  const doc = parseDocument(archiveDocument(text)), positions = contentPositionMap(doc, text.content)
  const candidates = []
  for (let offset = text.content.indexOf(snapshot); offset !== -1; offset = text.content.indexOf(snapshot, offset + 1)) {
    const range = canonicalArchiveRange(doc, {
      from: positions.position(offset, 1), to: positions.position(offset + snapshot.length, -1),
    })
    if (text.content.slice(positions.offset(range.from), positions.offset(range.to)) === snapshot) candidates.push(range)
  }
  return candidates
}

// Readonly analysis. Explicit approved recovery is a separate repository API.
export async function analyzePublicationAnchors({ publications, texts, userDays, anchors = [] }) {
  const sources = new Map(texts.map(text => [text.textId, text]))
  const days = new Map(userDays.map(day => [day.userDayId, day]))
  const attached = new Map(anchors.map(anchor => [anchor.publicationId, anchor]))
  return Promise.all(publications.map(async publication => {
    const report = { publicationId: publication.publicationId, channel: publication.channel,
      sourceId: publication.source.sourceId, historicalRange: publication.source.range,
      historicalRevision: publication.source.sourceRevision, snapshotContent: publication.snapshot.content,
      candidates: [] }
    const text = sources.get(publication.source.sourceId), day = days.get(text?.userDayId)
    if (publication.source.sourceType !== 'archive' || !text || text.userId !== publication.userId || !day ||
      day.userId !== publication.userId || day.userDayId !== publication.source.archive?.userDayId ||
      day.dayKey !== publication.source.archive?.dayKey) return { ...report, status: 'source-unavailable' }
    report.currentRevision = text.revision
    const anchor = attached.get(publication.publicationId)
    if (anchor) {
      if (anchor.userId !== publication.userId || anchor.sourceId !== text.textId || anchor.sourceType !== 'archive') return { ...report, status: 'anchor-identity-conflict' }
      if (anchor.sourceRevision !== text.revision) return { ...report, status: 'anchor-revision-conflict' }
      if (anchor.status === 'attached') return { ...report, status: 'attached', liveRange: anchor.range }
      report.previousStatus = anchor.status
    }
    try {
      const document = archiveDocument(text)
      report.candidates = exactSnapshotRanges(text, publication.snapshot.content)
      report.documentUnchanged = publication.source.documentSha256 === await digest(JSON.stringify(document)) &&
        publication.source.contentSha256 === await digest(text.content)
      return { ...report, status: report.candidates.length === 1 ? 'unique-exact-candidate' : report.candidates.length ? 'ambiguous' : 'no-exact-match' }
    } catch (error) { return { ...report, status: 'analysis-error', error: error.message } }
  }))
}
