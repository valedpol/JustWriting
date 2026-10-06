import test from 'node:test'
import assert from 'node:assert/strict'
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { createDayEditorState } from './dayOperations.js'
import { createWritingState } from './browserState.js'
import { firstTextHasMark, toggleFirstTextMark } from './formatting.js'
import { trackSemanticTransaction, getSemanticMarkup } from './semanticHistory.js'
import { assertSameArchiveText } from './archivePresentation.js'

function editor(document) {
  return createDayEditorState({ contentFormat: 'tiptap-json', contentVersion: 1, document, semanticMarkup: [] })
}
const doc = (...content) => ({ type: 'doc', content })
const p = (...content) => ({ type: 'paragraph', content })
const text = (value, marks = []) => ({ type: 'text', text: value, marks: marks.map(type => ({ type })) })
for (const mark of ['bold', 'italic', 'underline']) {
  for (const startsMarked of [false, true]) {
    test(`${mark}: mixed selection follows first text character, including whitespace and backward selection (${startsMarked})`, () => {
      let state = editor(doc(p(text('  😀', startsMarked ? [mark] : []), text(' хвост ', startsMarked ? [] : [mark]))))
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1, 1)))
      const before = state.doc, selection = state.selection.toJSON()
      assert.equal(firstTextHasMark(state, state.schema.marks[mark]), startsMarked)
      toggleFirstTextMark(state.schema.marks[mark])(state, tr => { state = state.applyTransaction(trackSemanticTransaction(state, tr)).state })
      assertSameArchiveText(before, state.doc)
      assert.deepEqual(state.selection.toJSON(), selection)
      state.doc.descendants(node => { if (node.isText) assert.equal(Boolean(state.schema.marks[mark].isInSet(node.marks)), !startsMarked) })
      assert.deepEqual(getSemanticMarkup(state), [])
    })
  }
}

test('AllSelection skips structural boundaries and preserves other marks and empty paragraphs', () => {
  let state = editor(doc({ type: 'horizontalRule' }, p(), p({ type: 'hardBreak' }, text('One', ['italic']), text('Two', ['bold', 'underline'])), p()))
  state = state.apply(state.tr.setSelection(new AllSelection(state.doc)))
  const before = state.doc
  toggleFirstTextMark(state.schema.marks.bold)(state, tr => { state = state.applyTransaction(trackSemanticTransaction(state, tr)).state })
  assertSameArchiveText(before, state.doc)
  assert.equal(state.doc.nodeAt(5).marks.some(mark => mark.type.name === 'italic'), true)
  assert.ok(JSON.stringify(state.doc.toJSON()).includes('underline'))
})

test('non-text selection is a no-op; cursor toggles typing marks without changing the document', () => {
  let state = editor(doc({ type: 'horizontalRule' }, p()))
  state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))
  assert.equal(firstTextHasMark(state, state.schema.marks.bold), null)
  assert.equal(toggleFirstTextMark(state.schema.marks.bold)(state, () => assert.fail()), false)
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)))
  const before = state.doc
  toggleFirstTextMark(state.schema.marks.bold)(state, tr => { state = state.apply(tr) })
  assert.ok(state.schema.marks.bold.isInSet(state.storedMarks))
  assert.ok(state.doc.eq(before))
})

test('main editor keymap uses the same first-character rule for Mod-b/i/u', () => {
  for (const [key, name] of [['b', 'bold'], ['i', 'italic'], ['u', 'underline']]) {
    let state = createWritingState({ contentFormat: 'tiptap-json', contentVersion: 1,
      document: doc(p(text('first '), text('last', [name]))), semanticMarkup: [] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)))
    const view = { get state() { return state }, dispatch(tr) { state = state.applyTransaction(trackSemanticTransaction(state, tr)).state } }
    const handled = state.plugins.some(plugin => plugin.props.handleKeyDown?.(view, { key, keyCode: key.toUpperCase().charCodeAt(0), ctrlKey: !/Mac|iP(hone|[oa]d)/.test(globalThis.navigator?.platform ?? ''), metaKey: /Mac|iP(hone|[oa]d)/.test(globalThis.navigator?.platform ?? ''), altKey: false, shiftKey: false }))
    assert.equal(handled, true)
    state.doc.descendants(node => { if (node.isText) assert.ok(state.schema.marks[name].isInSet(node.marks)) })
  }
})
