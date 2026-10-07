import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { TextSelection, AllSelection } from '@tiptap/pm/state'
import { undo, redo, undoDepth } from '@tiptap/pm/history'
import { transaction, openDatabase, DATABASE_VERSION } from './database.js'
import { saveArchivePresentation } from './archivePresentationRepository.js'
import { createArchiveController } from '../editor/archiveController.js'
import { createDayEditorState } from '../editor/dayOperations.js'
import { archiveEditorRecord } from '../editor/archiveDocument.js'
import { legacyToDocument, parseDocument } from '../editor/document.js'
import { toggleFirstTextMark } from '../editor/formatting.js'
import { assignSelectionMarkup, getSemanticMarkup, SemanticStep, trackSemanticTransaction } from '../editor/semanticHistory.js'

const factory = new IDBFactory(), databaseName = `jw-archive-test-${crypto.randomUUID()}`
globalThis.indexedDB = { open: (_name, version) => factory.open(databaseName, version) }
const names = ['settings', 'texts', 'userDays', 'wordCountSamples']
const readAll = () => transaction(names, 'readonly', (tx, done) => {
  const result = {}
  for (const name of names) {
    const request = tx.objectStore(name).getAll()
    request.onsuccess = () => { result[name] = request.result }
  }
  done(result)
})
async function seed(content = 'Один два три', legacy = false) {
  const textId = crypto.randomUUID(), userId = crypto.randomUUID(), userDayId = crypto.randomUUID()
  const record = { textId, userId, userDayId, dayKey: '2026-09-26', revision: 3, content,
    createdAt: 10, updatedAt: 20, unknown: { a: undefined, b: null, date: new Date(5) },
    dayStartsAt: 0, dayEndsAt: 86400000, timeZone: 'Europe/Moscow', dayPolicyVersion: 10 }
  if (!legacy) Object.assign(record, { contentFormat: 'tiptap-json', contentVersion: 1, document: legacyToDocument(content), semanticMarkup: [] })
  await transaction(names, 'readwrite', tx => {
    tx.objectStore('texts').add(record)
    tx.objectStore('userDays').add({ userDayId, userId, dayKey: record.dayKey, state: 'closed', startsAt: 0, endsAt: 86400000, policyVersion: 10 })
    tx.objectStore('wordCountSamples').add({ sampleId: crypto.randomUUID(), userDayId, timestamp: 100, wordCount: 3 })
    tx.objectStore('settings').add({ key: userId, unknown: null })
  })
  return record
}
async function format(controller, name = 'bold') {
  let task
  assert.equal(toggleFirstTextMark(controller.state.schema.marks[name])(controller.state, tr => { task = controller.dispatch(tr) }), true)
  await task
}
const selectAll = controller => controller.dispatch(controller.state.tr.setSelection(new AllSelection(controller.state.doc)))
const history = async (controller, command) => {
  let task
  assert.equal(command(controller.state, tr => { task = controller.dispatch(tr) }), true)
  await task
}

test('archive format/semantic Undo/Redo change only authorized fields, preserving original records and counts', async () => {
  const original = await seed()
  const controller = createArchiveController(original)
  const before = await readAll()
  await selectAll(controller)
  await format(controller)
  const formatted = controller.snapshot.record
  assert.equal(formatted.content, original.content)
  assert.deepEqual(formatted, { ...original, document: controller.state.doc.toJSON(), revision: original.revision + 1 })
  for (const [id, kind] of [['tag-a', 'tag'], ['tag-b', 'tag'], ['title', 'title']]) {
    await controller.dispatch(assignSelectionMarkup(controller.state, { id, kind, valueId: id, value: id }))
  }
  const markup = getSemanticMarkup(controller.state)
  await format(controller, 'italic')
  assert.deepEqual(getSemanticMarkup(controller.state), markup)
  const final = controller.state.doc.toJSON()
  for (let i = 0; i < 5; i++) await history(controller, undo)
  assert.deepEqual(controller.state.doc.toJSON(), original.document)
  assert.deepEqual(getSemanticMarkup(controller.state), [])
  for (let i = 0; i < 5; i++) await history(controller, redo)
  assert.deepEqual(controller.state.doc.toJSON(), final)
  assert.deepEqual(getSemanticMarkup(controller.state), markup)
  const after = await readAll()
  for (const name of names.filter(name => name !== 'texts')) assert.deepEqual(after[name], before[name])
  assert.equal(after.texts.length, before.texts.length)
  assert.deepEqual(after.texts.filter(r => r.textId !== original.textId), before.texts.filter(r => r.textId !== original.textId))
  assert.equal(undoDepth(createArchiveController(controller.snapshot.record).state), 0)
})

for (const source of ['a\nb\n\n', 'a\r\nb\r\n\r\n', 'a\rb\r\r', '😀 \r\n\n**literal**\r хвост\t\n']) {
  test(`legacy archive preserves exact content and unknown fields: ${JSON.stringify(source)}`, async () => {
    const original = await seed(source, true)
    const controller = createArchiveController(original)
    const before = await readAll()
    await selectAll(controller)
    await format(controller, 'underline')
    await history(controller, undo)
    await history(controller, redo)
    assert.equal(controller.snapshot.record.content, source)
    assert.equal(Object.hasOwn(controller.snapshot.record, 'semanticMarkup'), false, 'formatting must not materialize missing metadata')
    assert.deepEqual(controller.snapshot.record.unknown, original.unknown)
    assert.equal(controller.snapshot.record.updatedAt, original.updatedAt)
    const reopened = createArchiveController(controller.snapshot.record)
    assert.ok(reopened.state.doc.eq(controller.state.doc))
    assert.equal(reopened.snapshot.record.content, source)
    const after = await readAll()
    for (const name of names.filter(name => name !== 'texts')) assert.deepEqual(after[name], before[name])
  })
}

test('repository repeats whitelist and text/structure checks; hostile calls remain atomic', async () => {
  const original = await seed('a\nb')
  const state = createDayEditorState(archiveEditorRecord(original))
  const alternate = parseDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' },
  ] }] })
  const before = await readAll()
  const bad = [state.tr.insertText('bad', 1), state.tr.delete(1, 2), state.tr.insertText('a', 1, 2),
    state.tr.replaceWith(0, state.doc.content.size, alternate.content)]
  for (const tr of bad) {
    await assert.rejects(saveArchivePresentation(original.userId, original, tr), /только для чтения/)
    await assert.rejects(saveArchivePresentation(original.userId, original, trackSemanticTransaction(state, tr)), /только для чтения/)
  }
  const nested = new SemanticStep([], [], state.tr.insertText('x', 1).steps[0])
  await assert.rejects(saveArchivePresentation(original.userId, original, state.tr.step(new SemanticStep([], [], nested))), /только для чтения/)
  await assert.rejects(saveArchivePresentation('other', original, state.tr.addMark(1, 2, state.schema.marks.bold.create())), /пользователю/)
  assert.deepEqual(await readAll(), before)
})

test('repository revision conflicts reject a second writer; no-op does not increase revision', async () => {
  const original = await seed()
  const state = createDayEditorState(archiveEditorRecord(original))
  const tr = state.tr.addMark(1, 4, state.schema.marks.bold.create())
  const results = await Promise.allSettled([saveArchivePresentation(original.userId, original, tr), saveArchivePresentation(original.userId, original, tr)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.match(results.find(r => r.status === 'rejected').reason.message, /другой вкладке/)
  const saved = results.find(r => r.status === 'fulfilled').value
  const current = createDayEditorState(saved)
  assert.deepEqual(await saveArchivePresentation(saved.userId, saved, current.tr), saved)
})

test('capability blocks all changes and Undo while existing formatting and selection survive', async () => {
  const original = await seed()
  let permitted = true
  const controller = createArchiveController(original, { canChangePresentation: () => permitted })
  await selectAll(controller); await format(controller)
  const formatted = controller.snapshot.record
  permitted = false
  assert.equal(controller.snapshot.canChangePresentation, false)
  assert.equal(controller.snapshot.writable, false)
  let undoTask
  undo(controller.state, tr => { undoTask = controller.dispatch(tr) })
  await assert.rejects(undoTask, /недоступно/)
  await assert.rejects(controller.dispatch(assignSelectionMarkup(controller.state, { id: 'a', kind: 'tag', valueId: 'a', value: 'a' })), /недоступно/)
  await controller.dispatch(controller.state.tr.setSelection(TextSelection.create(controller.state.doc, 1, 2)))
  assert.deepEqual(controller.snapshot.record, formatted)
  assert.ok(controller.state.doc.rangeHasMark(1, 2, controller.state.schema.marks.bold))
})

test('rapid stale commands and save errors fail without optimistic document mutation', async () => {
  const original = await seed()
  const controller = createArchiveController(original)
  const bold = controller.state.tr.addMark(1, 4, controller.state.schema.marks.bold.create())
  const italic = controller.state.tr.addMark(1, 4, controller.state.schema.marks.italic.create())
  const results = await Promise.allSettled([controller.dispatch(bold), controller.dispatch(italic)])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  await assert.rejects(controller.flush())
  const failing = createArchiveController(original, { save: async () => { throw new Error('storage failed') } })
  await assert.rejects(failing.dispatch(bold), /storage failed/)
  assert.deepEqual(failing.snapshot.record, original)
  assert.ok(failing.state.doc.eq(bold.before))
  await assert.rejects(failing.flush(), /storage failed/)
})

test('physical UUID database closes and reopens with complete records intact and fresh session history', async () => {
  const original = await seed()
  const controller = createArchiveController(original)
  await selectAll(controller); await format(controller)
  const expected = await readAll()
  const db = await openDatabase()
  db.close()
  const reopened = await new Promise((resolve, reject) => {
    const request = factory.open(databaseName, DATABASE_VERSION)
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
  })
  try {
    const actual = await new Promise((resolve, reject) => {
      const tx = reopened.transaction(names, 'readonly'), result = {}
      for (const name of names) {
        const request = tx.objectStore(name).getAll(); request.onsuccess = () => { result[name] = request.result }
      }
      tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error)
    })
    assert.deepEqual(actual, expected)
    const record = actual.texts.find(r => r.textId === original.textId)
    assert.equal(record.content, original.content)
    assert.equal(undoDepth(createArchiveController(record).state), 0)
  } finally { reopened.close() }
})
