import { AddMarkStep, RemoveMarkStep, ReplaceStep, ReplaceAroundStep } from '@tiptap/pm/transform'
import { parseDocument, documentFromRecord } from '../editor/document.js'
import { archiveDocument } from '../editor/archiveDocument.js'
import { SemanticStep } from '../editor/semanticHistory.js'
import { PublicationTextStep } from '../editor/publicationHistory.js'
import { contentPositionMap } from './archiveSource.js'

function editStep(wrapped) {
  let step = wrapped
  if (step?.constructor === SemanticStep) step = step.textStep
  const history = step?.constructor === PublicationTextStep ? step : null
  if (history) step = history.textStep
  if (step && ![ReplaceStep, ReplaceAroundStep, AddMarkStep, RemoveMarkStep].includes(step.constructor)) {
    throw new Error('Unsupported publication mapping step')
  }
  return { step, history }
}

// Proof is replayed against the actual repository record, never merely trusted
// because a UI supplied a Mapping or a final snapshot.
export function validatePublicationEdit(current, next, proof) {
  const before = parseDocument(documentFromRecord(current)), after = parseDocument(next.document)
  if (!proof) {
    if (!before.eq(after)) throw new Error('Publication anchors require the accepted transaction steps')
    return { before, steps: [] }
  }
  if (!before.eq(parseDocument(proof.beforeDocument))) throw new Error('Publication mapping source document conflict')
  let doc = before
  const steps = []
  for (const wrapped of proof.steps) {
    const pair = editStep(wrapped)
    const result = wrapped.apply(doc)
    if (result.failed) throw new Error('Publication mapping step failed')
    parseDocument(result.doc.toJSON())
    steps.push({ ...pair, before: doc, after: result.doc })
    doc = result.doc
  }
  if (!doc.eq(after)) throw new Error('Publication mapping target document conflict')
  return { before, steps }
}

export function mapPublicationAnchors(anchors, current, next, proof) {
  const { before, steps } = validatePublicationEdit(current, next, proof)
  const original = parseDocument(archiveDocument(current))
  const conversion = !original.eq(before)
    ? { from: contentPositionMap(original, current.content), to: contentPositionMap(before, current.content) } : null
  const receipts = []
  const mapped = anchors.map(value => {
    if (value.sourceRevision !== current.revision || value.userId !== current.userId || value.sourceId !== current.textId ||
      value.sourceType !== 'archive' || value.coordinateVersion !== 1) throw new Error('Publication anchor revision/owner conflict')
    let anchor = structuredClone(value)
    if (anchor.status === 'attached' && conversion) anchor.range = {
      from: conversion.to.position(conversion.from.offset(anchor.range.from), 1),
      to: conversion.to.position(conversion.from.offset(anchor.range.to), -1),
    }
    for (const { step, history, before: stepBefore, after } of steps) {
      if (!step) continue
      const origin = history?.inverse ? 'after' : 'before', target = history?.inverse ? 'before' : 'after'
      const saved = history?.receipt.entries.get(anchor.publicationId)
      if (anchor.status === 'detached') {
        if (history && anchor.detachedBy?.id === history.id && anchor.detachedBy.side === origin && saved?.[target]) {
          anchor.range = { ...saved[target] }; anchor.status = 'attached'; delete anchor.detachedBy
          if (anchor.range.from < 1 || anchor.range.from >= anchor.range.to || anchor.range.to >= after.content.size) {
            throw new Error('Restored publication range outside document')
          }
        }
        continue
      }
      if (anchor.status !== 'attached') throw new Error('Invalid publication anchor status')
      const range = anchor.range
      if (!range || range.from < 1 || range.from >= range.to || range.to >= stepBefore.content.size) throw new Error('Invalid live publication range')
      const start = step.getMap().mapResult(range.from, 1), end = step.getMap().mapResult(range.to, -1)
      if (start.pos >= end.pos || (start.deletedAcross && end.deletedAcross) ||
        (start.deleted && end.deleted && step.getMap().ranges.length)) {
        anchor.status = 'detached'; anchor.range = null
        if (history) {
          anchor.detachedBy = { id: history.id, side: target }
          receipts.push({ receipt: history.receipt, id: anchor.publicationId, pair: { [origin]: { ...range }, [target]: null } })
        }
      } else anchor.range = { from: start.pos, to: end.pos }
      if (anchor.status === 'attached' && (anchor.range.from < 1 || anchor.range.to >= after.content.size)) throw new Error('Mapped publication range outside document')
    }
    anchor.sourceRevision = next.revision
    return anchor
  })
  return { anchors: mapped, commitReceipts() {
    for (const item of receipts) item.receipt.entries.set(item.id, item.pair)
  } }
}
