import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TextSelection } from '@tiptap/pm/state'
import { undo, redo, undoDepth } from '@tiptap/pm/history'
import { toggleMark } from '@tiptap/pm/commands'
import { openWritingController } from './writingController.js'
import { loadText, saveRichText } from '../storage/textRepository.js'
import { assignSelectionMarkup, confirmSlashMarkup, getSemanticMarkup } from './semanticHistory.js'
import { semanticSuggestions } from './semanticSuggestions.js'

const profile = () => ({ userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 })
const attributes = { id: 'tag', valueId: 'v', kind: 'tag', value: 'заметки', assignedAt: 1 }
const run = async (controller, command) => {
  let task
  assert.equal(command(controller.state, tr => { task = controller.dispatch(tr) }), true)
  await task
}

test('UI controller keeps optimistic state and selection while saves commit in order', async () => {
  const p = profile()
  const c = await openWritingController({ profile: p })
  const a = c.dispatch(c.state.tr.insertText('Привет', 1))
  const b = c.dispatch(c.state.tr.insertText(' мир', 7))
  const selected = c.dispatch(c.state.tr.setSelection(TextSelection.create(c.state.doc, 2, 6)), 'selection')
  const state = c.state
  assert.equal(c.snapshot.text, 'Привет мир')
  await Promise.all([a, b, selected])
  assert.equal(c.state, state)
  assert.equal(c.state.selection.from, 2)
  assert.equal(c.state.selection.to, 6)
  assert.equal(c.snapshot.status, 'saved')
  assert.equal((await loadText(p.userId, c.snapshot.context.dayKey)).content, 'Привет мир')
  await c.check()
  assert.equal(c.state, state)
  assert.ok(undoDepth(c.state) > 0)
})

test('format, semantic assignment and slash confirmation persist and share normal Undo/Redo', async () => {
  const c = await openWritingController({ profile: profile() })
  await c.dispatch(c.state.tr.insertText('Текст/', 1))
  await c.dispatch(c.state.tr.setSelection(TextSelection.create(c.state.doc, 1, 6)), 'selection')
  await run(c, toggleMark(c.state.schema.marks.bold))
  await c.dispatch(assignSelectionMarkup(c.state, attributes), 'selection-markup')
  await c.dispatch(confirmSlashMarkup(c.state, 6, { ...attributes, id: 'title', kind: 'title', value: 'Начало' }), 'slash-markup')
  assert.equal(c.snapshot.text, 'Текст')
  assert.equal(getSemanticMarkup(c.state).length, 2)
  assert.equal(getSemanticMarkup(c.state)[1].range, null)
  await run(c, undo)
  assert.equal(c.snapshot.text, 'Текст/')
  assert.equal(getSemanticMarkup(c.state).length, 1)
  await run(c, redo)
  assert.equal(c.snapshot.text, 'Текст')
  assert.equal(c.snapshot.record.semanticMarkup.length, 2)
})

test('slash tag placement survives continuation, Undo/Redo and repository reload', async () => {
  const p = profile()
  const c = await openWritingController({ profile: p })
  await c.dispatch(c.state.tr.insertText('Текст/', 1))
  await c.dispatch(confirmSlashMarkup(c.state, 6, attributes), 'slash-markup')
  const placed = getSemanticMarkup(c.state)
  await c.dispatch(c.state.tr.insertText(' продолжение', 6))
  assert.deepEqual(getSemanticMarkup(c.state), placed)
  await run(c, undo)
  assert.equal(c.snapshot.text, 'Текст')
  assert.deepEqual(getSemanticMarkup(c.state), placed)
  await run(c, redo)
  assert.equal(c.snapshot.text, 'Текст продолжение')
  assert.deepEqual(getSemanticMarkup(c.state), placed)
  const reloaded = await openWritingController({ profile: p })
  assert.equal(reloaded.snapshot.text, c.snapshot.text)
  assert.deepEqual(getSemanticMarkup(reloaded.state), placed)
})

test('typing after composition completion can queue immediately without stale state or duplicate input', async () => {
  const c = await openWritingController({ profile: profile() })
  c.beginComposition()
  await c.dispatch(c.state.tr.insertText('n', 1))
  await c.dispatch(c.state.tr.insertText('你', 1, 2))
  const finishing = c.finishComposition()
  const following = c.dispatch(c.state.tr.insertText('好', 2))
  await Promise.all([finishing, following])
  assert.equal(c.snapshot.text, '你好')
  assert.equal(c.snapshot.record.content, '你好')
  await c.finishComposition()
  assert.equal(c.snapshot.record.content, '你好')
})

test('failed queued saves keep the visible buffer; explicit retry saves all edits in order', async () => {
  let writes = 0
  const c = await openWritingController({ profile: profile(), services: {
    saveRichText: (...args) => ++writes === 1 ? Promise.reject(new Error('disk error')) : saveRichText(...args),
  } })
  const a = c.dispatch(c.state.tr.insertText('A', 1))
  const b = c.dispatch(c.state.tr.insertText('B', 2))
  await Promise.allSettled([a, b])
  assert.equal(c.snapshot.text, 'AB')
  assert.equal(c.snapshot.status, 'error')
  await assert.rejects(c.flush())
  await c.retry()
  assert.equal(c.snapshot.record.content, 'AB')
  assert.equal(c.snapshot.status, 'saved')
  await c.flush()
})

test('user-only suggestions put latest first, then frequency; query and category remain separate', () => {
  const item = (value, assignedAt, kind = 'tag') => ({ value, valueId: value, assignedAt, kind })
  const records = [
    { userId: 'me', semanticMarkup: [item('частый', 1), item('частый', 2), item('редкий', 3), item('последний', 4), item('Название', 5, 'title')] },
    { userId: 'other', semanticMarkup: [item('секрет', 9)] },
  ]
  assert.deepEqual(semanticSuggestions(records, 'me', 'tag').map(v => v.value), ['последний', 'частый', 'редкий'])
  assert.deepEqual(semanticSuggestions(records, 'me', 'tag', 'ЧА').map(v => v.value), ['частый'])
  assert.deepEqual(semanticSuggestions(records, 'me', 'title').map(v => v.value), ['Название'])
})

test('periodic word observations continue for an unchanged active session and stop after exit', async () => {
  let samples = 0
  const c = await openWritingController({ profile: profile(), services: { sampleWordCount: async () => { samples++; return null } } })
  await c.dispatch(c.state.tr.insertText('Слова', 1))
  assert.equal(samples, 1)
  await c.check()
  assert.equal(samples, 2)
  await c.endWriting()
  await c.check()
  assert.equal(samples, 2)
})
