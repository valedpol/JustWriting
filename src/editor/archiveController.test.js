import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TextSelection } from '@tiptap/pm/state'
import { toggleFirstTextMark } from './formatting.js'
import { toggleMark } from '@tiptap/pm/commands'
import { undo, redo } from '@tiptap/pm/history'
import { createArchiveController } from './archiveController.js'
import { openWritingController } from './writingController.js'
import { assignSelectionMarkup, getSemanticMarkup, trackSemanticTransaction } from './semanticHistory.js'
import { loadText } from '../storage/textRepository.js'
import { transaction } from '../storage/database.js'

const attrs = { id: 'title', kind: 'title', valueId: 'v', value: 'Офис' }
const profile = () => ({ userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 })
const stores = () => transaction(['settings', 'userDays', 'wordCountSamples'], 'readonly', (tx, done) => {
  const result = {}
  for (const name of ['settings', 'userDays', 'wordCountSamples']) {
    const request = tx.objectStore(name).getAll()
    request.onsuccess = () => { result[name] = request.result }
  }
  done(result)
})

test('archive rejects text and paste-like replacement; selection metadata persists', async () => {
  const c = await openWritingController({ profile: profile() })
  await c.dispatch(c.state.tr.insertText('Авторский текст', 1))
  const original = c.snapshot.record
  const archive = createArchiveController(original)
  await archive.dispatch(archive.state.tr.setSelection(TextSelection.create(archive.state.doc, 1, 5)))
  for (const tr of [archive.state.tr.insertText('bad'), archive.state.tr.deleteSelection()]) {
    await assert.rejects(archive.dispatch(tr), /только для чтения/)
    await assert.rejects(archive.dispatch(trackSemanticTransaction(archive.state, tr)), /только для чтения/)
  }
  assert.deepEqual(await loadText(original.userId, original.dayKey), original)
  await archive.dispatch(assignSelectionMarkup(archive.state, attrs))
  const saved = await loadText(original.userId, original.dayKey)
  assert.deepEqual(saved.document, original.document)
  assert.equal(saved.content, original.content)
  assert.equal(saved.semanticMarkup[0].value, 'Офис')
  assert.deepEqual(getSemanticMarkup(createArchiveController(saved).state), saved.semanticMarkup)
})

test('current day adopts own archive metadata without day/session changes and keeps editing history', async () => {
  const c = await openWritingController({ profile: profile() })
  await c.dispatch(c.state.tr.insertText('Сегодня текст', 1))
  let formatting
  await c.dispatch(c.state.tr.setSelection(TextSelection.create(c.state.doc, 1, 8)))
  toggleMark(c.state.schema.marks.bold)(c.state, tr => { formatting = c.dispatch(tr) })
  await formatting
  const beforeRecord = c.snapshot.record
  const sessionId = c.snapshot.sessionId
  const beforeStores = await stores()
  const archive = createArchiveController(beforeRecord, { onSaved: c.adoptArchiveMetadata })
  await archive.dispatch(archive.state.tr.setSelection(TextSelection.create(archive.state.doc, 1, 8)))
  await archive.dispatch(assignSelectionMarkup(archive.state, attrs))
  assert.deepEqual(await stores(), beforeStores)
  assert.equal(c.snapshot.sessionId, sessionId)
  assert.deepEqual(c.state.doc.toJSON(), beforeRecord.document)
  assert.equal(getSemanticMarkup(c.state)[0].value, 'Офис')
  await c.dispatch(c.state.tr.insertText('!', c.state.doc.content.size - 1))
  assert.equal(c.snapshot.record.content, 'Сегодня текст!')
  assert.equal(c.snapshot.record.semanticMarkup[0].value, 'Офис')
  let task
  undo(c.state, tr => { task = c.dispatch(tr) }); await task
  assert.equal(c.snapshot.record.content, 'Сегодня текст')
  assert.equal(c.snapshot.record.semanticMarkup[0].value, 'Офис')
  redo(c.state, tr => { task = c.dispatch(tr) }); await task
  assert.equal(c.snapshot.record.content, 'Сегодня текст!')
  assert.ok(c.snapshot.record.document.content[0].content[0].marks.some(m => m.type === 'bold'))
})


test('current day adopts archive B/I/U without losing text history, semantic markup, sessions or other stores', async () => {
  const c = await openWritingController({ profile: profile() })
  await c.dispatch(c.state.tr.insertText('Сегодня текст', 1))
  await c.dispatch(c.state.tr.setSelection(TextSelection.create(c.state.doc, 1, 8)))
  await c.dispatch(assignSelectionMarkup(c.state, attrs))
  const original = c.snapshot.record, sessionId = c.snapshot.sessionId, beforeStores = await stores()
  const archive = createArchiveController(original, { onSaved: c.adoptArchiveMetadata })
  await archive.dispatch(archive.state.tr.setSelection(TextSelection.create(archive.state.doc, 1, 8)))
  for (const name of ['bold', 'italic', 'underline']) {
    let task
    toggleFirstTextMark(archive.state.schema.marks[name])(archive.state, tr => { task = archive.dispatch(tr) })
    await task
    assert.ok(c.state.doc.eq(archive.state.doc))
    assert.equal(c.snapshot.record.revision, archive.snapshot.record.revision)
    assert.equal(c.snapshot.record.content, original.content)
  }
  assert.equal(c.snapshot.sessionId, sessionId)
  assert.deepEqual(await stores(), beforeStores)
  assert.deepEqual(getSemanticMarkup(c.state), original.semanticMarkup)
  await c.dispatch(c.state.tr.insertText('!', c.state.doc.content.size - 1))
  let task
  undo(c.state, tr => { task = c.dispatch(tr) }); await task
  assert.equal(c.snapshot.record.content, original.content)
  assert.ok(c.state.doc.eq(archive.state.doc))
  redo(c.state, tr => { task = c.dispatch(tr) }); await task
  assert.equal(c.snapshot.record.content, original.content + '!')
  assert.deepEqual(getSemanticMarkup(c.state), original.semanticMarkup)
  undo(c.state, tr => { task = c.dispatch(tr) }); await task
  undo(c.state, tr => { task = c.dispatch(tr) }); await task
  assert.equal(c.snapshot.record.content, original.content)
  assert.equal(c.state.doc.rangeHasMark(1, 8, c.state.schema.marks.underline), false)
  assert.ok(c.state.doc.rangeHasMark(1, 8, c.state.schema.marks.bold))
  assert.deepEqual(getSemanticMarkup(c.state), original.semanticMarkup)
})
