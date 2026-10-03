import { EditorState, Selection } from '@tiptap/pm/state'
import { closeHistory, history, isHistoryTransaction } from '@tiptap/pm/history'
import { ReplaceStep } from '@tiptap/pm/transform'
import { CONTENT_FORMAT, CONTENT_VERSION, documentFromRecord, parseDocument } from './document.js'
import { SemanticStep, getSemanticMarkup, semanticHistoryPlugin, trackSemanticTransaction } from './semanticHistory.js'

const kinds = new Set(['input', 'paste', 'composition', 'delete', 'format', 'undo', 'redo', 'selection-markup', 'slash-markup', 'semantic', 'selection'])

export function createDayEditorState(record = null) {
  return EditorState.create({
    doc: parseDocument(documentFromRecord(record)),
    plugins: [semanticHistoryPlugin(record?.contentFormat ? record.semanticMarkup : []), history()],
  })
}

export function editorSnapshot(state) {
  return {
    contentFormat: CONTENT_FORMAT, contentVersion: CONTENT_VERSION,
    document: state.doc.toJSON(), semanticMarkup: getSemanticMarkup(state),
  }
}

// Track only newly inserted spans through the actual steps. Repeated IME
// replacements replace these spans instead of concatenating intermediate input.
// Old text between separate insertions must never be included in the transfer.
export function insertedSlices(transaction) {
  let spans = []
  for (const wrapped of transaction.steps) {
    const step = wrapped instanceof SemanticStep ? wrapped.textStep : wrapped
    if (!step) continue
    const map = step.getMap()
    spans = spans.flatMap(({ from, to }) => {
      const start = map.mapResult(from, 1)
      const end = map.mapResult(to, -1)
      return start.pos < end.pos && !(start.deleted && end.deleted) ? [{ from: start.pos, to: end.pos }] : []
    })
    if (step instanceof ReplaceStep && step.slice.size) spans.push({ from: step.from, to: step.from + step.slice.size })
    spans.sort((a, b) => a.from - b.from)
    const merged = []
    for (const span of spans) {
      const last = merged.at(-1)
      if (last && span.from <= last.to) last.to = Math.max(last.to, span.to)
      else merged.push({ ...span })
    }
    spans = merged
  }
  return spans.map(({ from, to }) => transaction.doc.slice(from, to))
}

function detachedDraft(value) {
  if (!value) return null
  if (!['tag', 'title'].includes(value.kind) || typeof value.value !== 'string') throw new Error('Некорректный смысловой черновик')
  // No document coordinates or implicit attachment survive a day change.
  return structuredClone({ kind: value.kind, value: value.value, valueId: value.valueId ?? null, assignedAt: value.assignedAt ?? null })
}

export function captureDayOperation({ id = crypto.randomUUID(), source, transaction, kind, acceptedAt = Date.now(), sessionId = null, semanticDraft = null }) {
  if (!kinds.has(kind) || !Number.isFinite(acceptedAt) || typeof id !== 'string' || !id) throw new Error('Некорректная редакторская операция')
  const tracked = trackSemanticTransaction(source.state, transaction)
  const applied = source.state.applyTransaction(tracked)
  if (!applied.transactions.length) throw new Error('Редактор отклонил операцию')
  const transferable = ['input', 'paste', 'composition'].includes(kind) && !isHistoryTransaction(tracked)
  const previousIds = new Set(getSemanticMarkup(source.state).map(item => item.id))
  const slashDrafts = getSemanticMarkup(applied.state)
    .filter(item => item.source === 'slash' && !previousIds.has(item.id)).map(detachedDraft)
  const draft = detachedDraft(semanticDraft)
  return Object.freeze({
    id, kind, acceptedAt, sessionId, userId: source.context.userId, dayKey: source.context.dayKey,
    beforeState: source.state, afterState: applied.state, changed: tracked.steps.length > 0,
    slices: Object.freeze(transferable ? insertedSlices(tracked) : []),
    drafts: Object.freeze(draft ? [draft] : slashDrafts),
  })
}

export function transferDayOperation(state, operation) {
  if (!operation.slices.length) return { state, changed: false }
  const tr = closeHistory(state.tr)
  for (const slice of operation.slices) {
    const end = Selection.atEnd(tr.doc).to
    tr.replaceRange(end, end, slice)
  }
  tr.setSelection(Selection.atEnd(tr.doc))
  const next = state.applyTransaction(trackSemanticTransaction(state, tr)).state
  // A transferred operation cannot share Undo with the next day's next input.
  return { state: next.apply(closeHistory(next.tr)), changed: tr.steps.length > 0 }
}
