import { parseDocument, documentToContent, CONTENT_FORMAT, CONTENT_VERSION } from '../editor/document.js'

export const PUBLICATION_CHANNELS = ['profile', 'feed', 'internet']
export const publicProfileSettingsKey = userId => `publicProfile:${userId}`

export function assertChannels(channels) {
  if (!Array.isArray(channels) || !channels.length || new Set(channels).size !== channels.length ||
      channels.some(channel => !PUBLICATION_CHANNELS.includes(channel))) throw new Error('Invalid publication channels')
}

export function publicationDuplicateKey(publication) {
  const { source } = publication
  return [publication.userId, source.sourceType, source.sourceId, source.range.from, source.range.to, publication.channel]
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

function copySnapshot(input) {
  const { content, document, contentFormat, contentVersion, title } = input
  if (typeof content !== 'string' || !content.length || (title !== undefined && (typeof title !== 'string' || !title.trim()))) throw new Error('Invalid snapshot text/title')
  const snapshot = structuredClone({ content, document, contentFormat, contentVersion, ...(title !== undefined ? { title } : {}) })
  parseDocument(snapshot.document)
  if (snapshot.contentFormat !== CONTENT_FORMAT || snapshot.contentVersion !== CONTENT_VERSION ||
      documentToContent(snapshot.document) !== snapshot.content.replace(/\r\n?/g, '\n')) throw new Error('Invalid publication snapshot')
  return snapshot
}

// No update API: each channel owns an independent immutable snapshot.
export function makePublication({ publicationId, userId, channel, publishedAt, prepared, profile, settings }) {
  assertChannels([channel])
  if (typeof publicationId !== 'string' || !publicationId || typeof userId !== 'string' || !userId ||
      !Number.isSafeInteger(publishedAt) || publishedAt < 0) throw new Error('Invalid publication identity/date')
  if (prepared.source.sourceType !== 'archive') throw new Error('Unsupported source type')
  const { source } = prepared
  if (typeof source.sourceId !== 'string' || !source.sourceId ||
      !Number.isSafeInteger(source.sourceRevision) || source.sourceRevision < 0 || source.coordinateVersion !== 1 ||
      !Number.isSafeInteger(source.range?.from) || !Number.isSafeInteger(source.range?.to) ||
      source.range.from < 0 || source.range.from >= source.range.to ||
      ![source.contentSha256, source.documentSha256].every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) ||
      typeof source.archive?.userDayId !== 'string' || !source.archive.userDayId ||
      typeof source.archive?.dayKey !== 'string' || !source.archive.dayKey) throw new Error('Invalid publication source')
  const snapshot = copySnapshot(prepared.snapshot)
  const record = { publicationId, userId, channel, publishedAt, source: structuredClone(prepared.source), snapshot }
  if (channel !== 'profile') {
    if (!profile || profile.userId !== userId || typeof profile.displayName !== 'string' || !profile.displayName.trim()) throw new Error('Author profile unavailable')
    const visibility = settings?.authorVisibility === undefined ? 'visible' : settings.authorVisibility
    if (!['visible', 'hidden'].includes(visibility) || (settings && settings.userId !== userId)) throw new Error('Invalid author settings')
    record.authorVisibility = visibility
    record.author = { userId, displayName: profile.displayName }
  }
  return freeze(record)
}

export function immutablePublication(record) { return freeze(structuredClone(record)) }

// A reader receives no source/provenance or owner-management payload.
export function feedPublicationProjection(record, publicAuthor) {
  if (record.authorVisibility === 'visible' && (typeof publicAuthor?.displayName !== 'string' || !publicAuthor.displayName.trim() ||
      typeof publicAuthor.publicId !== 'string' || !publicAuthor.publicId || typeof publicAuthor.allowNameDisclosure !== 'boolean')) {
    throw new Error('Public author unavailable')
  }
  return freeze({ publicationId: record.publicationId, channel: record.channel, publishedAt: record.publishedAt,
    snapshot: copySnapshot(record.snapshot), authorVisibility: record.authorVisibility,
    ...(/^\d{4}-\d{2}-\d{2}$/.test(record.source?.archive?.dayKey ?? '') ? { writtenOn: record.source.archive.dayKey } : {}),
    ...(record.authorVisibility === 'visible' ? { author: { publicId: publicAuthor.publicId, displayName: publicAuthor.displayName,
      allowNameDisclosure: publicAuthor.allowNameDisclosure, displayLabel: publicAuthor.displayName + (publicAuthor.allowNameDisclosure ? ' ›' : '') } } : {}) })
}
export function sortPublications(records) {
  return records.sort((a, b) => b.publishedAt - a.publishedAt || (a.publicationId < b.publicationId ? -1 : a.publicationId > b.publicationId ? 1 : 0))
}
