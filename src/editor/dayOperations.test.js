import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Fragment, Slice } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { undo, redo, undoDepth } from '@tiptap/pm/history'
import { openDaySession } from './daySession.js'
import { captureDayOperation, createDayEditorState, editorSnapshot } from './dayOperations.js'
import { getSemanticMarkup, assignSelectionMarkup, confirmSlashMarkup } from './semanticHistory.js'
import { documentToContent, legacyToDocument } from './document.js'
import { loadText, listTexts, saveText, saveRichText } from '../storage/textRepository.js'
import { resolveToday, loadUserDay } from '../storage/dayRepository.js'
import { GRACE_DURATION } from '../domain/grace.js'

const before = Date.parse('2026-10-01T23:59:00Z')
const attributes = { id: 'tag-1', kind: 'tag', valueId: 'value-1', value: 'заметки', assignedAt: before }
const content = session => documentToContent(session.current.state.doc.toJSON())
async function setup({ owner = 'owner', liveSession = owner, text = 'Старый текст/', services = {} } = {}) {
  const profile = { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 }
  const initial = await resolveToday(profile, before)
  const record = text === null ? null : await saveText(initial.context, null, text, before, owner)
  const session = await openDaySession({ profile, now: before + 1, sessionId: liveSession, services })
  return { session, profile, old: initial.context, record, end: initial.context.dayEndsAt, deadline: initial.context.dayEndsAt + GRACE_DURATION }
}
const endPosition = state => state.doc.content.size - 1
async function select(session, from, to = from) {
  const state = session.current.state
  await session.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)), { kind: 'selection', acceptedAt: before + 2 })
}
function historyTransaction(command, state) {
  let result
  assert.equal(command(state, tr => { result = tr }), true)
  return result
}

// These tests use the real day/text repositories and isolated user IDs.
test('opening and checking do not create text, day or history; selection does not save or start a session', async () => {
  const { session, profile, old } = await setup({ owner: null, text: null })
  await session.check(before + 10)
  await select(session, 1)
  assert.equal(session.current.sessionId, null)
  assert.equal(await loadText(profile.userId, old.dayKey), null)
  assert.equal(await loadUserDay(profile.userId, old.dayKey), null)
  assert.equal(undoDepth(session.current.state), 0)
})

test('ordinary input at boundary stays in owned grace; exact deadline transfers only the new insertion', async () => {
  const { session, profile, old, end, deadline } = await setup()
  const a = await session.dispatch(session.current.state.tr.insertText('А', 2), { acceptedAt: end })
  assert.equal(a.crossedDay, false)
  assert.equal(a.context.dayKey, old.dayKey)
  assert.equal((await loadUserDay(profile.userId, old.dayKey)).state, 'grace')
  const savedOld = await loadText(profile.userId, old.dayKey)
  const b = await session.dispatch(session.current.state.tr.insertText('Б', 3), { acceptedAt: deadline })
  assert.equal(b.crossedDay, true)
  assert.equal(content(session), 'Б')
  assert.deepEqual(await loadText(profile.userId, old.dayKey), savedOld)
  assert.equal((await loadUserDay(profile.userId, old.dayKey)).state, 'closed')
  assert.equal(undoDepth(b.state), 1)
  await session.dispatch(historyTransaction(undo, b.state), { kind: 'undo', acceptedAt: deadline + 1 })
  assert.equal(content(session), '')
  assert.equal(undoDepth(session.current.state), 0)
})

test('replacement on a closed day transfers insertion without copying prefix, suffix or deleted selection', async () => {
  const { session, profile, old, record, deadline } = await setup()
  await session.dispatch(session.current.state.tr.insertText('Новое', 2, 7), { acceptedAt: deadline })
  assert.equal(content(session), 'Новое')
  assert.deepEqual(await loadText(profile.userId, old.dayKey), record)
})

test('formatted paste preserves paragraphs, hard breaks and B/I/U when transferred', async () => {
  const { session, deadline } = await setup()
  const state = session.current.state
  const s = state.schema
  const pasted = new Slice(Fragment.fromArray([
    s.nodes.paragraph.create(null, [s.text('Жирный', [s.marks.bold.create()]), s.nodes.hardBreak.create(), s.text('Курсив', [s.marks.italic.create()])]),
    s.nodes.paragraph.create(null, s.text('Линия', [s.marks.underline.create()])),
  ]), 1, 1)
  await session.dispatch(state.tr.replaceSelection(pasted), { kind: 'paste', acceptedAt: deadline })
  assert.equal(content(session), 'Жирный\nКурсив\nЛиния')
  const document = session.current.state.doc.toJSON()
  assert.equal(document.content.length, 2)
  assert.equal(document.content[0].content[0].marks[0].type, 'bold')
  assert.equal(document.content[0].content[1].type, 'hardBreak')
  assert.equal(document.content[0].content[2].marks[0].type, 'italic')
  assert.equal(document.content[1].content[0].marks[0].type, 'underline')
})

test('multiple insertion steps carry only final inserted spans and final marks, never intervening old text', async () => {
  const { session, deadline } = await setup({ text: 'abcdefghij' })
  const state = session.current.state
  const tr = state.tr.insertText('X', 2).insertText('Y', 9).addMark(2, 3, state.schema.marks.bold.create())
  await session.dispatch(tr, { kind: 'paste', acceptedAt: deadline })
  assert.equal(content(session), 'XY')
  assert.equal(session.current.state.doc.firstChild.firstChild.marks[0].type.name, 'bold')
})

test('IME holds intermediate states in memory and routes just the final replacement at completion after grace', async () => {
  const { session, profile, old, record, deadline } = await setup()
  const id = session.beginComposition('ime-1')
  let state = session.updateComposition(id, session.current.state.tr.insertText('n', 2, 5)).state
  state = session.updateComposition(id, state.tr.insertText('ni', 2, 3)).state
  assert.equal((await session.check(deadline)).deferred, true)
  assert.deepEqual(await loadText(profile.userId, old.dayKey), record)
  assert.equal(content(session), record.content)
  const final = state.tr.insertText('你', 2, 4)
  const result = await session.finishComposition(id, { transaction: final, acceptedAt: deadline + 1 })
  assert.equal(result.crossedDay, true)
  assert.equal(content(session), '你')
  assert.deepEqual(await loadText(profile.userId, old.dayKey), record)
  const revision = result.record.revision
  const duplicated = await session.finishComposition(id, { transaction: final, acceptedAt: deadline + 2 })
  assert.equal(duplicated.record.revision, revision)
  assert.deepEqual(session.updateComposition(id, final), { ignored: true })
  await session.dispatch(final, { id, kind: 'composition', acceptedAt: deadline + 3 })
  assert.equal(session.current.record.revision, revision)
  assert.equal(content(session), '你')
})

test('IME ending inside owned grace remains one Undo event in the old day', async () => {
  const { session, end, old, record } = await setup()
  const id = session.beginComposition()
  let state = session.updateComposition(id, session.current.state.tr.insertText('n', 2, 5)).state
  state = session.updateComposition(id, state.tr.insertText('你', 2, 3)).state
  const result = await session.finishComposition(id, { acceptedAt: end + 10 })
  assert.equal(result.context.dayKey, old.dayKey)
  assert.equal(content(session), 'С你ый текст/')
  assert.equal(undoDepth(result.state), 1)
  await session.dispatch(historyTransaction(undo, result.state), { kind: 'undo', acceptedAt: end + 11 })
  assert.equal(content(session), record.content)
})

test('composition accepted before grace expiry uses completion time even if queue finishes later', async () => {
  const { session, deadline, old } = await setup()
  const id = session.beginComposition()
  session.updateComposition(id, session.current.state.tr.insertText('終', 1))
  const pending = session.finishComposition(id, { acceptedAt: deadline - 1 })
  const check = session.check(deadline + 1)
  const saved = await pending
  assert.equal(saved.context.dayKey, old.dayKey)
  assert.ok(saved.record.content.startsWith('終'))
  await check
  assert.notEqual(session.current.context.dayKey, old.dayKey)
  assert.equal(content(session), '')
})

for (const kind of ['delete', 'bold', 'italic', 'underline', 'undo', 'redo', 'selection-markup', 'slash-markup']) {
  test(`${kind}: allowed within grace, never reapplies old positions in the next day`, async () => {
    for (const crossing of [false, true]) {
      const { session, profile, old, end, deadline } = await setup()
      if (['undo', 'redo'].includes(kind)) {
        await session.dispatch(session.current.state.tr.insertText('Z', 1), { acceptedAt: before + 3 })
        if (kind === 'redo') await session.dispatch(historyTransaction(undo, session.current.state), { kind: 'undo', acceptedAt: before + 4 })
      }
      if (kind === 'selection-markup') await select(session, 2, 7)
      const state = session.current.state
      let tr
      let operationKind = kind
      if (kind === 'delete') tr = state.tr.delete(1, 7)
      else if (['bold', 'italic', 'underline'].includes(kind)) { tr = state.tr.addMark(1, 7, state.schema.marks[kind].create()); operationKind = 'format' }
      else if (kind === 'undo' || kind === 'redo') tr = historyTransaction(kind === 'undo' ? undo : redo, state)
      else if (kind === 'selection-markup') tr = assignSelectionMarkup(state, attributes)
      else tr = confirmSlashMarkup(state, endPosition(state) - 1, attributes)
      const savedOld = await loadText(profile.userId, old.dayKey)
      const result = await session.dispatch(tr, { kind: operationKind, acceptedAt: crossing ? deadline : end + 1 })
      if (crossing) {
        assert.equal(result.status, 'not-applied')
        assert.equal(content(session), '')
        assert.equal(result.record, null)
        assert.equal(undoDepth(result.state), 0)
        assert.deepEqual(await loadText(profile.userId, old.dayKey), savedOld)
        assert.equal((await listTexts(profile.userId)).length, 1)
        assert.deepEqual(getSemanticMarkup(result.state), [])
        if (kind === 'slash-markup') {
          assert.equal(result.drafts[0].value, 'заметки')
          assert.equal('anchor' in result.drafts[0], false)
          assert.equal('range' in result.drafts[0], false)
        }
      } else {
        assert.equal(result.status, 'applied')
        assert.equal(result.context.dayKey, old.dayKey)
        assert.equal(result.record.revision, savedOld.revision + 1)
        if (kind === 'slash-markup') assert.equal(result.record.semanticMarkup[0].range, null)
        if (kind === 'selection-markup') assert.deepEqual(result.record.semanticMarkup[0].range, { from: 2, to: 7 })
      }
    }
  })
}

test('Undo with default input kind is still recognized as history and cannot transfer restored old text', async () => {
  const { session, deadline } = await setup()
  await session.dispatch(session.current.state.tr.delete(1, 5), { kind: 'delete', acceptedAt: before + 4 })
  await session.dispatch(historyTransaction(undo, session.current.state), { acceptedAt: deadline })
  assert.equal(content(session), '')
  assert.equal(session.current.record, null)
})

test('pending semantic command retains its typed value as a detached draft on rollover', async () => {
  const { session, deadline } = await setup()
  const result = await session.dispatch(session.current.state.tr, {
    kind: 'slash-markup', acceptedAt: deadline, semanticDraft: { kind: 'tag', value: 'зам', anchor: 7, range: null },
  })
  assert.equal(result.drafts[0].value, 'зам')
  assert.equal('anchor' in result.drafts[0], false)
  assert.equal(content(session), '')
  assert.deepEqual(getSemanticMarkup(result.state), [])
  assert.equal(result.record, null)
})

test('new-day existing document and metadata remain intact; old insertion appends with its own Undo only', async () => {
  const { session, profile, deadline } = await setup()
  const next = await resolveToday(profile, deadline)
  const state = createDayEditorState()
  const doc = legacyToDocument('Сегодня')
  const markup = [{ ...attributes, source: 'slash', anchor: 2, direction: 'backward', range: null }]
  const saved = await saveRichText(next.context, null, { ...editorSnapshot(state), document: doc, semanticMarkup: markup }, deadline)
  await session.dispatch(session.current.state.tr.insertText('!', 2), { acceptedAt: deadline + 1 })
  assert.equal(content(session), 'Сегодня!')
  assert.equal(session.current.record.textId, saved.textId)
  assert.deepEqual(getSemanticMarkup(session.current.state), markup)
  await session.dispatch(historyTransaction(undo, session.current.state), { kind: 'undo', acceptedAt: deadline + 2 })
  assert.equal(content(session), 'Сегодня')
  assert.equal(undoDepth(session.current.state), 0)
})

test('duplicate operation IDs share one promise and one committed revision through a rollover', async () => {
  const { session, deadline } = await setup()
  const source = session.current
  const op = session.capture(source.state.tr.insertText('X', 2), { id: 'once', acceptedAt: deadline })
  const first = session.submit(op)
  const second = session.submit(op)
  assert.equal(first, second)
  await first
  assert.equal(content(session), 'X')
  assert.equal(session.current.record.revision, 1)
  await session.submit(op)
  assert.equal(session.current.record.revision, 1)
})

test('queued optimistic operations from the old editor transfer exactly once after a timer rollover', async () => {
  const { session, deadline } = await setup()
  const source = session.current
  const first = session.capture(source.state.tr.insertText('X', 2), { source, acceptedAt: deadline })
  const secondSource = { ...source, state: first.afterState }
  const second = session.capture(secondSource.state.tr.insertText('Y', 3), { source: secondSource, acceptedAt: deadline + 1 })
  const checking = session.check(deadline)
  const saving = [session.submit(first), session.submit(second)]
  await checking
  await Promise.all(saving)
  assert.equal(content(session), 'XY')
  assert.equal(session.current.record.revision, 2)
})

test('reload and a different session cannot inherit persisted grace ownership', async () => {
  for (const liveSession of [null, 'stranger']) {
    const { session, profile, old, record, end } = await setup({ liveSession })
    await session.dispatch(session.current.state.tr.insertText('Новое', 2), { acceptedAt: end + 1 })
    assert.equal(content(session), 'Новое')
    assert.notEqual(session.current.context.dayKey, old.dayKey)
    assert.deepEqual(await loadText(profile.userId, old.dayKey), record)
  }
})

test('explicit session exit delegates to existing rules and cannot reopen grace', async () => {
  const { session, end, old } = await setup()
  await session.check(end + 1)
  await session.endWriting(end + 2)
  await session.dispatch(session.current.state.tr.insertText('Новый', 2), { acceptedAt: end + 3 })
  assert.notEqual(session.current.context.dayKey, old.dayKey)
  assert.equal(content(session), 'Новый')
})

test('multi-tab revision conflict retains operation and cannot silently adopt the other tab revision', async () => {
  const { session, old, profile, record } = await setup()
  const foreign = await saveText(old, record, 'Другая вкладка', before + 2, 'foreign')
  const operation = session.capture(session.current.state.tr.insertText('Моё', 1), { acceptedAt: before + 3 })
  await assert.rejects(session.submit(operation), /другой вкладке/)
  assert.equal(session.pendingFailure.operation.id, operation.id)
  assert.deepEqual(await loadText(profile.userId, old.dayKey), foreign)
  await assert.rejects(session.retry(operation.id), /другой вкладке/)
  assert.equal(content(session), record.content)
})

test('save failure retains the exact operation; retry and duplicate terminal events do not double insertion', async () => {
  let calls = 0
  const { session, deadline } = await setup({ services: {
    saveRichText: (...args) => ++calls === 1 ? Promise.reject(new Error('disk error')) : saveRichText(...args),
  } })
  const id = session.beginComposition('retry-ime')
  session.updateComposition(id, session.current.state.tr.insertText('終', 2))
  await assert.rejects(session.finishComposition(id, { acceptedAt: deadline }), /disk error/)
  assert.ok(session.pendingFailure)
  assert.equal((await session.check(deadline + 1)).deferred, true)
  await session.retry(id)
  await session.finishComposition(id, { acceptedAt: deadline + 2 })
  assert.equal(content(session), '終')
  assert.equal(session.current.record.revision, 1)
  assert.equal(session.pendingFailure, null)
})

test('sampling failure is reported separately and cannot make a committed text operation retryable', async () => {
  const { session } = await setup({ services: { sampleWordCount: () => Promise.reject(new Error('sample failure')) } })
  const result = await session.dispatch(session.current.state.tr.insertText('X', 1), { id: 'sample', acceptedAt: before + 3 })
  assert.equal(result.samplingError, 'sample failure')
  assert.equal(result.status, 'applied')
  assert.equal(session.pendingFailure, null)
  assert.throws(() => session.retry('sample'), /Нет неудачной/)
})

test('clock rollback into a closed day refuses writes and keeps the buffered operation', async () => {
  const { session, profile, old, deadline } = await setup()
  await resolveToday(profile, deadline)
  const op = session.capture(session.current.state.tr.insertText('X', 1), { acceptedAt: before + 3 })
  await assert.rejects(session.submit(op), /закрыт/)
  assert.equal(session.pendingFailure.operation, op)
  assert.equal((await loadUserDay(profile.userId, old.dayKey)).state, 'closed')
})

test('capture detaches transaction data and stale states cannot change a record', async () => {
  const { session, old } = await setup()
  const source = session.current
  const tr = source.state.tr.insertText('X', 1)
  const captured = session.capture(tr, { acceptedAt: before + 3 })
  tr.insertText('MUTATED', 1)
  await session.submit(captured)
  assert.ok(!content(session).includes('MUTATED'))
  const stale = captureDayOperation({ source, transaction: source.state.tr.insertText('Y', 1), kind: 'input', acceptedAt: before + 4 })
  await assert.rejects(session.submit(stale), /Устаревшее/)
  assert.equal(session.current.context.dayKey, old.dayKey)
})

test('in-memory session created by first real input owns grace; reload after that input does not', async () => {
  const { session, profile, old, end } = await setup({ owner: null, text: null })
  await session.dispatch(session.current.state.tr.insertText('Начало', 1), { acceptedAt: before + 4 })
  const owner = session.current.sessionId
  assert.ok(owner)
  assert.equal((await loadUserDay(profile.userId, old.dayKey)).writingSessionId, owner)
  await session.dispatch(session.current.state.tr.insertText('!', 7), { acceptedAt: end + 1 })
  assert.equal(session.current.context.dayKey, old.dayKey)
  const reloaded = await openDaySession({ profile, now: end + 2 })
  assert.notEqual(reloaded.current.context.dayKey, old.dayKey)
  assert.equal(reloaded.current.sessionId, null)
  assert.equal(content(reloaded), '')
})

test('old slash points and selection ranges stay in the closed record and never follow a transferred insertion', async () => {
  const { session, profile, old, deadline } = await setup()
  await session.dispatch(confirmSlashMarkup(session.current.state, endPosition(session.current.state) - 1, attributes), { kind: 'slash-markup', acceptedAt: before + 3 })
  await select(session, 2, 6)
  await session.dispatch(assignSelectionMarkup(session.current.state, { ...attributes, id: 'selection-1' }), { kind: 'selection-markup', acceptedAt: before + 4 })
  const savedOld = await loadText(profile.userId, old.dayKey)
  await session.dispatch(session.current.state.tr.insertText('X', 3), { acceptedAt: deadline })
  assert.equal(content(session), 'X')
  assert.deepEqual(getSemanticMarkup(session.current.state), [])
  assert.deepEqual(await loadText(profile.userId, old.dayKey), savedOld)
  assert.equal(savedOld.semanticMarkup[0].range, null)
})

test('post-boundary removal/formatting does not alter an existing short new-day document or revision', async () => {
  for (const kind of ['delete', 'format']) {
    const { session, profile, deadline } = await setup({ text: 'Очень длинный старый текст для старых позиций' })
    const next = await resolveToday(profile, deadline)
    const record = await saveText(next.context, null, 'Я', deadline)
    const state = session.current.state
    const tr = kind === 'delete' ? state.tr.delete(10, 30) : state.tr.addMark(10, 30, state.schema.marks.bold.create())
    await session.dispatch(tr, { kind, acceptedAt: deadline + 1 })
    assert.equal(content(session), 'Я')
    assert.deepEqual(session.current.record, record)
    assert.deepEqual(await loadText(profile.userId, next.context.dayKey), record)
  }
})

test('queued same-day input preserves all operations and allows no overtaking after a save failure', async () => {
  let count = 0
  const { session } = await setup({ services: { saveRichText: (...args) => ++count === 1 ? Promise.reject(new Error('offline')) : saveRichText(...args) } })
  const source = session.current
  const a = session.capture(source.state.tr.insertText('A', 1), { acceptedAt: before + 3 })
  const nextSource = { ...source, state: a.afterState }
  const b = session.capture(nextSource.state.tr.insertText('B', 2), { source: nextSource, acceptedAt: before + 4 })
  const results = await Promise.allSettled([session.submit(a), session.submit(b)])
  assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected'])
  assert.throws(() => session.retry(b.id), /предыдущую/)
  await session.retry(a.id)
  await session.retry(b.id)
  assert.ok(content(session).startsWith('AB'))
  assert.equal(session.current.record.revision, source.record.revision + 2)
})

test('a cancelled IME replacement leaves no intermediate fragment to transfer', async () => {
  const { session, deadline } = await setup()
  const id = session.beginComposition()
  const intermediate = session.updateComposition(id, session.current.state.tr.insertText('x', 2)).state
  session.updateComposition(id, intermediate.tr.delete(2, 3))
  const result = await session.finishComposition(id, { acceptedAt: deadline })
  assert.equal(result.status, 'not-applied')
  assert.equal(content(session), '')
  assert.equal(session.current.record, null)
})

test('a pure split at boundary transfers the newline, not old paragraph text', async () => {
  const { session, deadline } = await setup()
  await session.dispatch(session.current.state.tr.split(4), { acceptedAt: deadline })
  assert.equal(content(session), '\n')
  assert.equal(session.current.record, null)
})

test('paste into a new-day document ending in a rule is fitted using new document coordinates', async () => {
  const { session, profile, deadline } = await setup()
  const next = await resolveToday(profile, deadline)
  await saveRichText(next.context, null, {
    ...editorSnapshot(createDayEditorState()), document: { type: 'doc', content: [{ type: 'horizontalRule' }] },
  }, deadline)
  await session.dispatch(session.current.state.tr.insertText('X', 4), { kind: 'paste', acceptedAt: deadline + 1 })
  assert.equal(session.current.state.doc.firstChild.type.name, 'horizontalRule')
  assert.equal(content(session), '\nX')
})

test('cancelled IME inside the same day does not migrate legacy, increment revision or add Undo', async () => {
  const { session, profile, old, record } = await setup({ liveSession: null })
  const id = session.beginComposition()
  const state = session.updateComposition(id, session.current.state.tr.insertText('n', 2)).state
  session.updateComposition(id, state.tr.delete(2, 3))
  const result = await session.finishComposition(id, { acceptedAt: before + 4 })
  assert.equal(result.status, 'unchanged')
  assert.equal(session.current.sessionId, null)
  assert.deepEqual(await loadText(profile.userId, old.dayKey), record)
  assert.equal(undoDepth(result.state), 0)
})

test('repository still refuses an old-day save when another event closes grace after resolution', async () => {
  const { endWritingSession } = await import('../storage/dayRepository.js')
  let interrupted = false
  const { session, profile, old, record, end } = await setup({ services: {
    saveRichText: async (context, previous, snapshot, acceptedAt, sessionId) => {
      if (!interrupted) {
        interrupted = true
        await endWritingSession(context.userId, sessionId, acceptedAt)
      }
      return saveRichText(context, previous, snapshot, acceptedAt, sessionId)
    },
  } })
  const operation = session.capture(session.current.state.tr.insertText('Новое', 2), { acceptedAt: end + 1 })
  await assert.rejects(session.submit(operation), /закрыт/)
  assert.deepEqual(await loadText(profile.userId, old.dayKey), record)
  await session.retry(operation.id)
  assert.equal(content(session), 'Новое')
  assert.notEqual(session.current.context.dayKey, old.dayKey)
})

test('a queued timer observed during composition stays deferred even when finish runs before its callback', async () => {
  const { session, old, deadline } = await setup()
  const id = session.beginComposition()
  session.updateComposition(id, session.current.state.tr.insertText('終', 1))
  const timer = session.check(deadline)
  const completing = session.finishComposition(id, { acceptedAt: deadline - 1 })
  assert.equal((await timer).deferred, true)
  const result = await completing
  assert.equal(result.context.dayKey, old.dayKey)
  assert.ok(content(session).startsWith('終'))
})
