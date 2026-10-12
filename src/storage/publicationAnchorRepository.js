import { transaction } from './database.js'
import { analyzePublicationAnchors, exactSnapshotRanges } from '../publications/anchorRecovery.js'
import { assertArchiveSource, archiveSourceFingerprint } from '../publications/archiveSource.js'
import { bytesHash } from '../utils/files.js'
import { encode } from '../backup/backupCodec.js'
import { maintenance } from '../runtime/maintenance.js'
import { createArchiveSourceAdapter } from './archiveSourceAdapter.js'

export function readSourceAnchors(tx, userId, sourceId, done) {
  const read = tx.objectStore('publicationAnchors').index('userSource').getAll([userId, 'archive', sourceId])
  read.onsuccess = () => done(read.result)
}

// Called inside the text transaction. Session receipts become visible only
// after its oncomplete, so aborted writes cannot corrupt Undo recovery.
export function saveMappedAnchors(tx, current, next, proof, done, fail, mapPublicationAnchors) {
  if (!current) { done(() => {}); return }
  readSourceAnchors(tx, current.userId, current.textId, anchors => {
    try {
      if (!anchors.length) { done(() => {}); return }
      const mapped = mapPublicationAnchors(anchors, current, next, proof)
      for (const anchor of mapped.anchors) tx.objectStore('publicationAnchors').put(anchor)
      done(mapped.commitReceipts)
    } catch (error) { fail(error) }
  })
}

// Readonly archive presentation operations preserve the coordinate structure.
export function advanceAnchorRevision(tx, current, next, done, fail) {
  readSourceAnchors(tx, current.userId, current.textId, anchors => {
    try {
      for (const anchor of anchors) {
        if (anchor.sourceRevision !== current.revision || anchor.coordinateVersion !== 1) throw new Error('Publication anchor revision conflict')
        tx.objectStore('publicationAnchors').put({ ...anchor, sourceRevision: next.revision })
      }
      done(next)
    } catch (error) { fail(error) }
  })
}

export function listSourcePublicationAnchors(userId, sourceId) {
  return transaction(['publicationAnchors'], 'readonly', (tx, done) => readSourceAnchors(tx, userId, sourceId, done))
}

export async function analyzePublicationRecovery(userId, sourceId = null) {
  if (typeof userId !== 'string' || !userId) throw new Error('Invalid recovery owner')
  const data = await transaction(['publications', 'publicationAnchors', 'texts', 'userDays'], 'readonly', (tx, done) => {
    const data = {}; done(data)
    for (const name of tx.objectStoreNames) {
      const read = tx.objectStore(name).getAll()
      read.onsuccess = () => { data[name] = read.result.filter(row => row.userId === userId &&
        (!sourceId || (name === 'publications' ? row.source.sourceId === sourceId : name === 'publicationAnchors' ? row.sourceId === sourceId : true))) }
    }
  })
  return analyzePublicationAnchors({ ...data, anchors: data.publicationAnchors })
}

const recoveryStores = ['publications', 'publicationAnchors', 'texts', 'userDays']
// The backup codec sorts object keys and preserves structured-clone values.
// A decoded backup and the live IDB record must have the same proof regardless
// of property insertion order. Original source characters are never normalized.
export const publicationRecoveryProofHash = async value => bytesHash(new TextEncoder().encode(JSON.stringify(await encode(value))))
function readRecoveryData(tx, complete) {
  const data = {}; let remaining = recoveryStores.length
  for (const name of recoveryStores) {
    const read = tx.objectStore(name).getAll()
    read.onsuccess = () => { data[name] = read.result; if (!--remaining) complete(data) }
  }
}

function checkedRecoverySource(userId, confirmation, data) {
  const publication = data.publications.find(p => p.publicationId === confirmation.publicationId)
  const text = data.texts.find(t => t.textId === confirmation.sourceId)
  const day = data.userDays.find(d => d.userDayId === text?.userDayId)
  if (!publication || publication.userId !== userId || publication.source.sourceId !== confirmation.sourceId) throw new Error('Recovery publication unavailable to owner')
  assertArchiveSource(userId, { ...publication.source, sourceRevision: confirmation.sourceRevision }, text, day)
  if (data.publicationAnchors.some(a => a.publicationId === confirmation.publicationId)) throw new Error('Recovery anchor already exists; refusing overwrite')
  const candidates = exactSnapshotRanges(text, publication.snapshot.content)
  if (candidates.length !== 1 || candidates[0].from !== confirmation.range.from || candidates[0].to !== confirmation.range.to) {
    throw new Error('Recovery requires the approved unique exact range')
  }
  return { publication, text, day, fingerprint: archiveSourceFingerprint(text, day), publicationFingerprint: JSON.stringify(publication) }
}

export function createPublicationAnchorRecoveryRepository({ runTransaction = transaction, flush = async () => {
  if (!maintenance.hasRegisteredFlush()) throw new Error('A live source flush is required')
  await maintenance.flushPending()
} } = {}) {
  return {
    async recoverExact(userId, approved) {
      const confirmations = structuredClone(approved)
      if (typeof userId !== 'string' || !userId || !Array.isArray(confirmations) || !confirmations.length ||
        new Set(confirmations.map(c => c?.publicationId)).size !== confirmations.length) throw new Error('Invalid recovery confirmations')
      for (const c of confirmations) {
        if (!c || typeof c.publicationId !== 'string' || !c.publicationId || typeof c.sourceId !== 'string' || !c.sourceId ||
          !Number.isSafeInteger(c.sourceRevision) || c.sourceRevision < 0 || !Number.isSafeInteger(c.range?.from) ||
          !Number.isSafeInteger(c.range?.to) || c.range.from < 1 || c.range.to <= c.range.from ||
          !/^[a-f0-9]{64}$/.test(c.sourceFingerprintSha256 ?? '') || !/^[a-f0-9]{64}$/.test(c.publicationSha256 ?? '')) throw new Error('Invalid recovery proof')
      }
      await flush()
      const data = await runTransaction(recoveryStores, 'readonly', (tx, done) => readRecoveryData(tx, done))
      const prepared = await Promise.all(confirmations.map(async c => {
        const source = checkedRecoverySource(userId, c, data)
        if (await publicationRecoveryProofHash(JSON.parse(source.fingerprint)) !== c.sourceFingerprintSha256 ||
          await publicationRecoveryProofHash(source.publication) !== c.publicationSha256) {
          throw new Error('Recovery source/publication differs from approved report')
        }
        return source
      }))
      // All checks are repeated synchronously inside the one atomic write
      // transaction. Async hashing is complete before opening this boundary.
      return runTransaction(recoveryStores, 'readwrite', (tx, done, fail) => readRecoveryData(tx, current => {
        try {
          const sources = confirmations.map((c, index) => {
            const source = checkedRecoverySource(userId, c, current)
            if (source.fingerprint !== prepared[index].fingerprint || source.publicationFingerprint !== prepared[index].publicationFingerprint) throw new Error('Recovery revision/source changed before commit')
            return source
          })
          const publications = new Map(current.publications.map(p => [p.publicationId, p]))
          const keys = new Set()
          const key = (p, range) => JSON.stringify([p.userId, p.source.sourceType, p.source.sourceId, p.channel, range.from, range.to])
          for (const anchor of current.publicationAnchors) {
            const p = publications.get(anchor.publicationId)
            if (!p || p.userId !== userId || anchor.status !== 'attached') continue
            if (sources.some(s => s.text.textId === p.source.sourceId) && anchor.sourceRevision !== current.texts.find(t => t.textId === p.source.sourceId)?.revision) throw new Error('Publication anchor revision conflict')
            if (anchor.range) keys.add(key(p, anchor.range))
          }
          const anchors = sources.map((s, index) => {
            const range = confirmations[index].range, duplicateKey = key(s.publication, range)
            if (keys.has(duplicateKey)) throw new DOMException('Exact live publication already exists', 'ConstraintError')
            keys.add(duplicateKey)
            return { publicationId: s.publication.publicationId, userId, sourceType: 'archive', sourceId: s.text.textId,
              sourceRevision: s.text.revision, coordinateVersion: 1, status: 'attached', range: { ...range } }
          })
          for (const anchor of anchors) tx.objectStore('publicationAnchors').add(anchor)
          done({ recoveredCount: anchors.length, publicationIds: anchors.map(a => a.publicationId), anchors })
        } catch (error) { fail(error) }
      }))
    },
  }
}

const recoveryRepository = createPublicationAnchorRecoveryRepository()
export const recoverExactPublicationAnchors = (...args) => recoveryRepository.recoverExact(...args)

// Explicit user-selected coordinates, not a snapshot search or automatic repair.
// Missing legacy anchors and persisted detached anchors are both reattachable.
export function createManualPublicationAnchorRepository({ runTransaction = transaction, flush } = {}) {
  const adapter = createArchiveSourceAdapter({ runTransaction, flush })
  return {
    async reattach(userId, publicationId, source) {
      if (typeof publicationId !== 'string' || !publicationId) throw new Error('Invalid publication identity')
      const prepared = await adapter.prepare(userId, source)
      return runTransaction(recoveryStores, 'readwrite', (tx, done, fail) => readRecoveryData(tx, data => {
        try {
          const publication = data.publications.find(p => p.publicationId === publicationId)
          const text = data.texts.find(t => t.textId === prepared.source.sourceId)
          const day = data.userDays.find(d => d.userDayId === text?.userDayId)
          adapter.assertCurrent(userId, prepared, text, day)
          if (!publication || publication.userId !== userId || publication.source.sourceType !== 'archive' ||
            publication.source.sourceId !== text.textId || publication.source.archive.userDayId !== day.userDayId ||
            publication.source.archive.dayKey !== day.dayKey) throw new Error('Publication/source unavailable to owner')
          const existing = data.publicationAnchors.find(a => a.publicationId === publicationId)
          if (existing && (existing.status !== 'detached' || existing.userId !== userId || existing.sourceType !== 'archive' ||
            existing.sourceId !== text.textId || existing.coordinateVersion !== 1 || existing.sourceRevision !== text.revision)) {
            throw new Error('Publication is not detached or anchor revision/identity conflicts')
          }
          const active = new Map(data.publications.filter(p => p.userId === userId && p.source.sourceType === 'archive' &&
            p.source.sourceId === text.textId).map(p => [p.publicationId, p]))
          for (const anchor of data.publicationAnchors) {
            const other = active.get(anchor.publicationId)
            if (!other || anchor.status !== 'attached') continue
            if (anchor.userId !== userId || anchor.sourceId !== text.textId || anchor.sourceType !== 'archive' ||
              anchor.coordinateVersion !== 1 || anchor.sourceRevision !== text.revision) throw new Error('Publication anchor revision/identity conflict')
            if (other.channel === publication.channel && anchor.range?.from === prepared.source.range.from &&
              anchor.range?.to === prepared.source.range.to) throw new DOMException('Exact live publication already exists', 'ConstraintError')
          }
          // Replacing detachedBy prevents an earlier Undo receipt from claiming
          // this deliberate new attachment. Publication/provenance are untouched.
          const anchor = { publicationId, userId, sourceType: 'archive', sourceId: text.textId,
            sourceRevision: text.revision, coordinateVersion: 1, status: 'attached', range: { ...prepared.source.range } }
          tx.objectStore('publicationAnchors').put(anchor)
          done(anchor)
        } catch (error) { fail(error) }
      }))
    },
  }
}

const manualRepository = createManualPublicationAnchorRepository()
export const reattachPublicationAnchor = (...args) => manualRepository.reattach(...args)
