import { applyArchiveFormatting } from './archivePresentation.js'
import { closeHistory, undoDepth, redoDepth } from '@tiptap/pm/history'
import { resolveToday, endWritingSession } from '../storage/dayRepository.js'
import { saveRichText } from '../storage/textRepository.js'
import { sampleWordCount } from '../storage/wordCountRepository.js'
import { SemanticStep, getSemanticMarkup, trackSemanticTransaction } from './semanticHistory.js'
import { captureDayOperation, createDayEditorState, editorSnapshot, transferDayOperation } from './dayOperations.js'

// Headless day queue; WritingController connects UI dispatch and timers.
export async function openDaySession({ profile, now = Date.now(), sessionId = null, getProfile = () => profile, services = {}, createState = createDayEditorState }) {
  const io = { resolveToday, saveRichText, sampleWordCount, endWritingSession, ...services }
  const initial = await io.resolveToday(await getProfile(), now, sessionId)
  let current = { ...initial, state: createState(initial.record) }
  let writingSession = sessionId // Never recover ownership from a persisted record.
  let queue = Promise.resolve()
  let failure = null
  let composition = null
  let observation = null
  const receipts = new Map()

  const enqueue = run => {
    const task = queue.then(run)
    queue = task.catch(() => {})
    return task
  }
  const view = () => ({ ...current, context: { ...current.context }, record: structuredClone(current.record), sessionId: writingSession })
  const beginInput = (changed, startSession = true) => {
    if (changed && startSession && !writingSession) writingSession = crypto.randomUUID()
    return writingSession
  }

  async function process(operation) {
    if (failure) throw new Error('Сначала повторите сохранение предыдущей операции')
    if (operation.userId !== profile.userId) throw new Error('Операция принадлежит другому пользователю')
    const resolved = await io.resolveToday(await getProfile(), operation.acceptedAt, operation.sessionId)
    if (!resolved.writable) throw new Error('Этот день уже закрыт. Операция сохранена в памяти для повторной обработки.')
    const switched = current.context.dayKey !== resolved.context.dayKey
    const base = switched ? { ...resolved, state: createState(resolved.record) }
      : { ...current, context: resolved.context, writable: resolved.writable }
    const crossing = operation.dayKey !== resolved.context.dayKey
    let state, changed
    if (crossing) ({ state, changed } = transferDayOperation(base.state, operation))
    else {
      if (base.state !== operation.beforeState) throw new Error('Устаревшее состояние редактора; старые позиции не применены')
      state = operation.afterState
      changed = operation.changed
    }
    // On the same day retain our committed revision, not a fresher foreign one
    // returned by resolveToday. The repository must detect a multi-tab conflict.
    const record = changed ? await io.saveRichText(base.context, base.record, editorSnapshot(state), operation.acceptedAt, operation.sessionId) : base.record
    current = { ...base, state, record }
    let samplingError = null
    if (changed && record && operation.sessionId) {
      observation = { sessionId: operation.sessionId, userDayId: record.userDayId }
      try { await io.sampleWordCount(profile.userId, record.userDayId, operation.sessionId) }
      catch (error) { samplingError = error.message }
    }
    return {
      ...view(), operationId: operation.id, crossedDay: crossing,
      status: changed ? 'applied' : crossing ? 'not-applied' : 'unchanged',
      reason: crossing && !changed ? 'old-day-operation' : null,
      drafts: crossing ? structuredClone(operation.drafts) : [], samplingError,
    }
  }

  function submit(operation) {
    if (receipts.has(operation.id)) return receipts.get(operation.id).promise
    const receipt = { operation, status: 'pending' }
    receipts.set(operation.id, receipt)
    receipt.promise = enqueue(async () => {
      try {
        const result = await process(operation)
        receipt.status = 'committed'
        return result
      } catch (error) {
        receipt.status = 'failed'
        if (!failure) failure = { operation, error }
        throw error
      }
    })
    return receipt.promise
  }

  const api = {
    get current() { return view() },
    adoptArchiveMetadata(previous, record) {
      return enqueue(() => {
        if (current.record?.textId !== record.textId) return view()
        if (composition || failure || current.record.revision !== previous.revision) {
          throw new Error('Редактор изменился во время назначения разметки. Перезагрузите запись.')
        }
        if (record.content !== current.record.content) throw new Error('Архивная операция изменила текст.')
        const loaded = createState(record)
        let state
        if (previous.contentFormat === undefined && !loaded.doc.eq(current.state.doc)) {
          // An untouched legacy day has no text-edit history to discard.
          if (undoDepth(current.state) || redoDepth(current.state)) throw new Error('Нельзя заменить документ с активной историей редактора.')
          state = loaded
        } else {
          const formatting = applyArchiveFormatting(closeHistory(current.state.tr), loaded.doc)
          const tracked = trackSemanticTransaction(current.state, formatting)
          const beforeMarkup = tracked.steps.length ? tracked.steps.at(-1).after : getSemanticMarkup(current.state)
          tracked.step(new SemanticStep(beforeMarkup, getSemanticMarkup(loaded))).setMeta('jwSemanticCommand', true)
          state = current.state.applyTransaction(tracked).state
        }
        current = { ...current, state, record }
        return view()
      })
    },
    get pendingFailure() { return failure ? { operation: failure.operation, message: failure.error.message } : null },
    capture(transaction, { source = view(), kind = 'input', id, acceptedAt = Date.now(), startSession = true, semanticDraft } = {}) {
      return captureDayOperation({ source, transaction, kind, id, acceptedAt, semanticDraft, sessionId: beginInput(transaction.steps.length > 0, startSession) })
    },
    submit,
    dispatch(transaction, options = {}) {
      if (options.id && receipts.has(options.id)) return receipts.get(options.id).promise
      if (composition) throw new Error('Во время IME используйте updateComposition и finishComposition')
      return submit(api.capture(transaction, options))
    },
    retry(id) {
      const receipt = receipts.get(id)
      if (!receipt || receipt.status !== 'failed') throw new Error('Нет неудачной операции для повторения')
      if (failure && failure.operation.id !== id) throw new Error('Сначала повторите предыдущую операцию')
      failure = null
      receipts.delete(id)
      return submit(receipt.operation)
    },
    check(now = Date.now()) {
      const checkedSession = writingSession
      const duringComposition = Boolean(composition)
      return enqueue(async () => {
        if (duringComposition || composition || failure) return { ...view(), deferred: true }
        const next = await io.resolveToday(await getProfile(), now, checkedSession)
        if (next.context.dayKey !== current.context.dayKey) {
          current = { ...next, state: createState(next.record) }
          writingSession = null
        } else current = { ...current, context: next.context, writable: next.writable }
        if (observation && observation.sessionId === writingSession && observation.userDayId === current.record?.userDayId) {
          // Retain periodic observations while an unchanged writing session is
          // open. A sampling failure cannot block text or day transitions.
          await io.sampleWordCount(profile.userId, observation.userDayId, writingSession).catch(() => {})
        }
        return view()
      })
    },
    endWriting(now = Date.now()) {
      if (composition) throw new Error('Сначала завершите IME-композицию')
      const id = writingSession
      writingSession = null
      return enqueue(() => id ? io.endWritingSession(profile.userId, id, now) : undefined)
    },
    beginComposition(id = crypto.randomUUID(), source = view()) {
      if (receipts.has(id)) throw new Error('Эта композиция уже завершена')
      if (composition) throw new Error('IME-композиция уже начата')
      composition = { id, source, state: source.state, transaction: closeHistory(source.state.tr), sessionId: writingSession }
      return id
    },
    updateComposition(id, transaction) {
      if (receipts.has(id)) return { ignored: true }
      if (!composition || composition.id !== id) throw new Error('IME-композиция не найдена')
      const tracked = trackSemanticTransaction(composition.state, transaction)
      const applied = composition.state.applyTransaction(tracked)
      if (!applied.transactions.length) throw new Error('Редактор отклонил IME-операцию')
      for (const step of tracked.steps) composition.transaction.step(step)
      composition.state = applied.state
      composition.transaction.setSelection(applied.state.selection.getBookmark().resolve(composition.transaction.doc))
      composition.transaction.setStoredMarks(applied.state.storedMarks)
      return { state: applied.state }
    },
    finishComposition(id, { transaction, acceptedAt = Date.now(), onCapture } = {}) {
      if (receipts.has(id)) return receipts.get(id).promise
      if (!composition || composition.id !== id) throw new Error('IME-композиция не найдена')
      if (transaction) api.updateComposition(id, transaction)
      const pending = composition
      // A cancelled preedit is not a real edit and must not migrate legacy data
      // or add a useless Undo event. This equality check is only for a no-op;
      // day routing and fragment extraction always use time and actual steps.
      const cancelled = pending.source.state.doc.eq(pending.state.doc)
        && JSON.stringify(getSemanticMarkup(pending.source.state)) === JSON.stringify(getSemanticMarkup(pending.state))
      const finalTransaction = cancelled
        ? pending.source.state.tr.setSelection(pending.state.selection.getBookmark().resolve(pending.source.state.doc)).setStoredMarks(pending.state.storedMarks)
        : pending.transaction
      const operation = captureDayOperation({
        id, source: pending.source, transaction: finalTransaction.setMeta('composition', id),
        kind: 'composition', acceptedAt,
        sessionId: pending.sessionId ?? beginInput(finalTransaction.steps.length > 0),
      })
      composition = null
      onCapture?.(operation)
      return submit(operation)
    },
    flush: () => queue,
  }
  return api
}
