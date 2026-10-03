import { maintenance } from '../runtime/maintenance.js'
import { createDayEditorState } from './dayOperations.js'
import { archiveEditorRecord } from './archiveDocument.js'
import { SemanticStep, getSemanticMarkup, trackSemanticTransaction } from './semanticHistory.js'
import { saveSemanticMarkup } from '../storage/semanticRepository.js'

export function createArchiveController(initialRecord, { onSaved = () => {}, save = saveSemanticMarkup } = {}) {
  let record = initialRecord
  let state = createDayEditorState(archiveEditorRecord(record))
  let queue = Promise.resolve()
  let saveFailure
  const listeners = new Set()
  const emit = () => listeners.forEach(listener => listener(api.snapshot))
  const api = {
    get state() { return state },
    get snapshot() { return { state, record, context: { userId: record.userId }, writable: !maintenance.blocked(), drafts: [] } },
    subscribe(listener) { listeners.add(listener); const off = maintenance.subscribe(() => emit()); return () => { listeners.delete(listener); off() } },
    keepDraft() {},
    dispatch(tr) {
      maintenance.assertNormal()
      // Defense in depth: editable:false alone is not an authorization boundary.
      if (!tr.before.eq(state.doc) || tr.steps.some(step => !(step instanceof SemanticStep) || step.textStep)) {
        return Promise.reject(new Error('Текст архива доступен только для чтения.'))
      }
      if (!tr.steps.length) {
        state = state.applyTransaction(trackSemanticTransaction(state, tr)).state
        emit()
        return Promise.resolve()
      }
      const acceptedQueue = queue
      const task = maintenance.normalOperation(() => acceptedQueue.then(async () => {
        const tracked = trackSemanticTransaction(state, tr)
        const next = state.applyTransaction(tracked).state
        if (!next.doc.eq(state.doc)) throw new Error('Изменение архивного текста запрещено.')
        const previous = record
        const saved = await save(record.userId, previous, getSemanticMarkup(next))
        saveFailure = undefined
        // Preserve any selection made while the storage transaction was pending.
        state = next.apply(next.tr.setSelection(state.selection.getBookmark().resolve(next.doc)))
        record = saved
        emit()
        await onSaved(saved, previous)
      }))
      queue = task.catch(error => { saveFailure = error })
      return task
    },
    flush: async () => { await queue; if (saveFailure) throw saveFailure },
  }
  return api
}
