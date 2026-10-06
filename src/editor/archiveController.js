import { maintenance } from '../runtime/maintenance.js'
import { createDayEditorState } from './dayOperations.js'
import { archiveEditorRecord } from './archiveDocument.js'
import { getSemanticMarkup, trackSemanticTransaction } from './semanticHistory.js'
import { saveArchivePresentation } from '../storage/archivePresentationRepository.js'
import { assertArchiveTransaction, assertSameArchiveText } from './archivePresentation.js'

export function createArchiveController(initialRecord, { onSaved = () => {}, save = saveArchivePresentation, canChangePresentation = () => true } = {}) {
  let record = initialRecord
  let state = createDayEditorState(archiveEditorRecord(record))
  let queue = Promise.resolve()
  let saveFailure
  const listeners = new Set()
  const emit = () => listeners.forEach(listener => listener(api.snapshot))
  const api = {
    get state() { return state },
    get snapshot() { return { state, record, context: { userId: record.userId }, writable: canChangePresentation() && !maintenance.blocked(), canChangePresentation: canChangePresentation(), drafts: [] } },
    subscribe(listener) { listeners.add(listener); const off = maintenance.subscribe(() => emit()); return () => { listeners.delete(listener); off() } },
    keepDraft() {},
    dispatch(tr) {
      maintenance.assertNormal()
      // Validate both direct commands and Undo/Redo, before and after queueing.
      try {
        if (!tr.before.eq(state.doc) || (tr.steps.length && !canChangePresentation())) throw new Error('Изменение представления архива недоступно.')
        assertArchiveTransaction(tr, getSemanticMarkup(state))
      } catch (error) { return Promise.reject(error) }
      if (!tr.steps.length) {
        state = state.applyTransaction(trackSemanticTransaction(state, tr)).state
        emit()
        return Promise.resolve()
      }
      const acceptedQueue = queue
      const task = maintenance.normalOperation(() => acceptedQueue.then(async () => {
        if (!canChangePresentation()) throw new Error('Изменение представления архива недоступно.')
        const tracked = trackSemanticTransaction(state, tr)
        const expectedMarkup = assertArchiveTransaction(tracked, getSemanticMarkup(state))
        const next = state.applyTransaction(tracked).state
        assertSameArchiveText(state.doc, next.doc)
        if (!next.doc.eq(tracked.doc) || JSON.stringify(getSemanticMarkup(next)) !== JSON.stringify(expectedMarkup)) throw new Error('Неожиданное изменение архивного состояния.')
        const previous = record
        const saved = await save(record.userId, previous, tracked)
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
