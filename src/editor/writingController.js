import { maintenance } from '../runtime/maintenance.js'
import { openDaySession } from './daySession.js'
import { createWritingState } from './browserState.js'
import { documentToContent } from './document.js'

export async function openWritingController(options) {
  const session = await openDaySession({ ...options, createState: createWritingState })
  let source = session.current
  let status = source.record ? 'saved' : 'idle'
  let error = ''
  let sequence = 0
  let composition = null
  let drafts = []
  const pending = new Map()
  const listeners = new Set()
  const emit = () => { for (const listener of listeners) listener(api.snapshot) }
  const preview = op => { source = { ...source, state: op.afterState }; emit() }
  const follow = (id, promise, version) => {
    pending.set(id, { promise, failed: false })
    promise.then(result => {
      pending.delete(id)
      if (result.drafts?.length) drafts = [...drafts, ...result.drafts]
      if (version === sequence && !composition) {
        source = result
        status = result.record ? 'saved' : 'idle'
        error = ''
      }
      emit()
    }, failure => {
      pending.set(id, { promise, failed: true })
      status = 'error'; error = failure.message; emit()
    })
    return promise
  }
  const api = {
    get state() { return source.state },
    get composing() { return Boolean(composition) },
    get snapshot() { return { ...source, writable: source.writable && !maintenance.blocked(), status, error, drafts, text: documentToContent(source.state.doc.toJSON()) } },
    subscribe(listener) { listeners.add(listener); const off = maintenance.subscribe(() => emit()); return () => { listeners.delete(listener); off() } },
    async adoptArchiveMetadata(record, previous) {
      const version = sequence
      const next = await session.adoptArchiveMetadata(previous, record)
      if (version === sequence && !composition && !pending.size) {
        source = next
        emit()
      }
    },
    dispatch(tr, kind = 'input') {
      maintenance.assertNormal()
      if (composition) {
        source = { ...source, state: session.updateComposition(composition.id, tr).state }
        emit()
        return Promise.resolve()
      }
      const op = session.capture(tr, { source, kind })
      const version = ++sequence
      if (op.changed) status = 'saving'
      preview(op)
      return follow(op.id, maintenance.trackAccepted(session.submit(op)), version)
    },
    beginComposition() {
      maintenance.assertNormal()
      if (!composition) composition = { id: session.beginComposition(undefined, source) }
    },
    finishComposition(acceptedAt = Date.now()) {
      if (maintenance.blocked()) return Promise.resolve()
      if (!composition) return Promise.resolve()
      const { id } = composition
      composition = null
      const version = ++sequence
      status = 'saving'
      const promise = session.finishComposition(id, { acceptedAt, onCapture: preview })
      return follow(id, maintenance.trackAccepted(promise), version)
    },
    async check(now = Date.now()) {
      if (maintenance.blocked()) return
      const version = sequence
      const next = await maintenance.trackAccepted(session.check(now))
      if (version === sequence && !composition && !pending.size && !next.deferred) {
        source = next
        status = next.record ? 'saved' : 'idle'
        error = next.writable ? '' : 'Этот день уже закрыт. Проверьте системное время.'
        emit()
      }
    },
    retry() {
      return maintenance.normalOperation(async () => {
      await session.flush()
      status = 'saving'; emit()
      try {
        for (const [id, entry] of pending) {
          if (!entry.failed) continue
          const result = await session.retry(id)
          pending.delete(id)
          if (result.drafts?.length) drafts.push(...result.drafts)
        }
        source = session.current; error = ''; status = source.record ? 'saved' : 'idle'; emit()
      } catch (failure) { status = 'error'; error = failure.message; emit(); throw failure }
      })
    },
    async flush() {
      if (composition) throw new Error('Сначала завершите ввод IME')
      await session.flush()
      if ([...pending.values()].some(entry => entry.failed)) throw new Error(error || 'Есть несохранённые изменения')
    },
    endWriting: () => maintenance.blocked() ? Promise.resolve() : maintenance.trackAccepted(session.endWriting()),
    keepDraft(draft) { drafts = [...drafts, structuredClone(draft)]; emit() },
    dismissDraft(index) { drafts = drafts.filter((_, i) => i !== index); emit() },
  }
  return api
}
