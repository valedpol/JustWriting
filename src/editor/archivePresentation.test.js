import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { Step, StepResult, AddMarkStep } from '@tiptap/pm/transform'
import { createDayEditorState } from './dayOperations.js'
import { legacyToDocument, parseDocument, documentToContent } from './document.js'
import { assertArchiveTransaction, assertSameArchiveText } from './archivePresentation.js'
import { SemanticStep, trackSemanticTransaction } from './semanticHistory.js'

const state = () => createDayEditorState({ contentFormat: 'tiptap-json', contentVersion: 1, document: legacyToDocument('first\nsecond'), semanticMarkup: [] })
class UnknownStep extends Step {
  apply(doc) { return StepResult.ok(doc) }
}
class DisguisedMark extends AddMarkStep {
  apply(doc) { return StepResult.ok(doc) }
}

test('whitelist accepts only B/I/U steps, including tracked history wrappers', () => {
  const s = state()
  for (const name of ['bold', 'italic', 'underline']) {
    const tr = s.tr.addMark(1, 4, s.schema.marks[name].create())
    assert.deepEqual(assertArchiveTransaction(tr, []), [])
    assert.deepEqual(assertArchiveTransaction(trackSemanticTransaction(s, tr), []), [])
  }
})

test('hostile insertion, deletion, replacement, same-text structural change, unknown/subclass/nested steps fail closed', () => {
  const s = state()
  const structural = s.tr.replaceWith(0, s.doc.content.size, parseDocument({ type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'first' }, { type: 'hardBreak' }, { type: 'text', text: 'second' },
  ] }] }).content)
  assert.equal(documentToContent(structural.doc.toJSON()), documentToContent(s.doc.toJSON()))
  for (const tr of [s.tr.insertText('X', 1), s.tr.delete(1, 2), s.tr.insertText('NEW', 1, 4), structural,
    s.tr.step(new UnknownStep()), s.tr.step(new DisguisedMark(1, 3, s.schema.marks.bold.create()))]) {
    assert.throws(() => assertArchiveTransaction(tr, []), /только для чтения/)
    assert.throws(() => assertArchiveTransaction(trackSemanticTransaction(s, tr), []), /только для чтения/)
  }
  const nested = new SemanticStep([], [], s.tr.insertText('X', 1).steps[0])
  assert.throws(() => assertArchiveTransaction(s.tr.step(new SemanticStep([], [], nested)), []), /только для чтения/)
  assert.throws(() => assertSameArchiveText(s.doc, structural.doc), /только для чтения/)
})

test('unknown marks and formatting wrappers that secretly change semantic data are rejected', () => {
  const schema = new Schema({ nodes: state().schema.spec.nodes, marks: state().schema.spec.marks.addToEnd('link', { attrs: { href: {} } }) })
  const s = EditorState.create({ schema, doc: schema.nodeFromJSON(legacyToDocument('abc')) })
  assert.throws(() => assertArchiveTransaction(s.tr.addMark(1, 3, schema.marks.link.create({ href: 'url' })), []), /только для чтения/)
  const base = state()
  const markup = [{ id: 'a', valueId: 'v', value: 'tag', kind: 'tag', source: 'selection', anchor: 3, direction: 'backward', range: { from: 1, to: 3 } }]
  const wrapped = new SemanticStep([], markup, base.tr.addMark(1, 3, base.schema.marks.bold.create()).steps[0])
  assert.throws(() => assertArchiveTransaction(base.tr.step(wrapped), []), /только для чтения/)
})

test('format-only invariants merge split text runs without changing paragraph/rule/break structure', () => {
  const s = state()
  const next = s.tr.addMark(2, 4, s.schema.marks.bold.create()).doc
  assertSameArchiveText(s.doc, next)
  const other = s.tr.insertText('f', 1, 2).doc
  assertSameArchiveText(s.doc, other)
  // Even a text-preserving ReplaceStep is forbidden at the transaction boundary.
  assert.throws(() => assertArchiveTransaction(s.tr.insertText('f', 1, 2), []), /только для чтения/)
})


test('a mark from a foreign schema is not accepted even if its name is bold', () => {
  const s = state()
  const schema = new Schema({ nodes: s.schema.spec.nodes, marks: s.schema.spec.marks })
  assert.throws(() => assertArchiveTransaction(s.tr.addMark(1, 3, schema.marks.bold.create()), []), /только для чтения/)
})
