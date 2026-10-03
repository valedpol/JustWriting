import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { history, undo, redo, undoDepth, redoDepth, closeHistory } from '@tiptap/pm/history'
import { Step } from '@tiptap/pm/transform'
import { parseDocument, legacyToDocument, documentToContent } from './document.js'
import { parseSemanticMarkup } from './semanticSnapshot.js'
import { selectionMarkup, slashMarkup } from './semanticMarkup.js'
import {
  semanticHistoryPlugin, getSemanticMarkup, trackSemanticTransaction, SemanticStep,
  assignSelectionMarkup, confirmSlashMarkup, setSemanticRange, removeSemanticMarkup,
} from './semanticHistory.js'

const attrs = (id = 'tag', kind = 'tag') => ({ id, kind, valueId: `value-${id}`, value: id, assignedAt: 123 })
const selected = (from = 3, to = 7, id = 'tag') => ({ ...attrs(id), source: 'selection', anchor: to, direction: 'backward', range: { from, to } })
const point = (anchor = 5, kind = 'tag') => ({ ...attrs(kind, kind), source: 'slash', anchor, direction: kind === 'tag' ? 'backward' : 'forward', range: null })
function editor(text = 'abcdefghij', markup = []) {
  let state = EditorState.create({ doc: parseDocument(legacyToDocument(text)), plugins: [semanticHistoryPlugin(markup), history()] })
  return {
    get state() { return state },
    get markup() { return getSemanticMarkup(state) },
    get text() { return documentToContent(state.doc.toJSON()) },
    apply(tr) { state = state.applyTransaction(trackSemanticTransaction(state, tr)).state },
    select(from, to = from) { this.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to))) },
    undo() { assert.equal(undo(state, tr => this.apply(tr)), true) },
    redo() { assert.equal(redo(state, tr => this.apply(tr)), true) },
    boundary() { this.apply(closeHistory(state.tr)) },
  }
}
const expectRoundtrip = (e, originalText, originalMarkup, changedText = e.text, changedMarkup = e.markup) => {
  e.undo()
  assert.equal(e.text, originalText)
  assert.deepEqual(e.markup, originalMarkup)
  e.redo()
  assert.equal(e.text, changedText)
  assert.deepEqual(e.markup, changedMarkup)
}

test('selection uses exact bounds and slash uses a point plus direction with null range', () => {
  const doc = parseDocument(legacyToDocument('abcdef'))
  const selection = TextSelection.create(doc, 2, 5)
  for (const kind of ['tag', 'title']) {
    const item = selectionMarkup(doc, selection, attrs(kind, kind))
    assert.deepEqual(item.range, { from: 2, to: 5 })
    assert.equal(item.source, 'selection')
    assert.equal(item.anchor, kind === 'tag' ? 5 : 2)
    const slash = slashMarkup(doc, 4, attrs(kind, kind))
    assert.equal(slash.range, null)
    assert.equal(slash.source, 'slash')
    assert.equal(slash.direction, kind === 'tag' ? 'backward' : 'forward')
    assert.deepEqual(parseSemanticMarkup([slash], doc.content.size), [slash])
  }
  assert.throws(() => selectionMarkup(doc, TextSelection.create(doc, 2), attrs()), /выделите/)
})

test('range mapping follows insertions before and inside, excluding insertion at both edges', () => {
  for (const [position, range] of [[1, { from: 5, to: 9 }], [3, { from: 5, to: 9 }], [5, { from: 3, to: 9 }], [7, { from: 3, to: 7 }], [9, { from: 3, to: 7 }]]) {
    const original = [selected()]
    const e = editor('abcdefghij', original)
    e.apply(e.state.tr.insertText('XY', position))
    assert.deepEqual(e.markup[0].range, range)
    assert.equal(e.markup[0].anchor, range.to)
    expectRoundtrip(e, 'abcdefghij', original)
  }
})

test('partial deletion shrinks range; full deletion and full replacement remove markup; Undo restores both', () => {
  for (const [from, to, insert, range] of [
    [4, 6, '', { from: 3, to: 5 }], [1, 5, '', { from: 1, to: 3 }],
    [5, 9, '', { from: 3, to: 5 }], [3, 7, '', null], [1, 10, '', null], [3, 7, 'replacement', null],
  ]) {
    const original = [selected()]
    const e = editor('abcdefghij', original)
    e.apply(e.state.tr.insertText(insert, from, to))
    assert.deepEqual(e.markup.map(item => item.range), range ? [range] : [])
    expectRoundtrip(e, 'abcdefghij', original)
  }
})

test('overlapping labels map independently and one deletion can remove only one of them', () => {
  const original = [selected(3, 7, 'inner'), selected(2, 9, 'outer')]
  const e = editor('abcdefghij', original)
  e.apply(e.state.tr.delete(3, 7))
  assert.deepEqual(e.markup.map(item => [item.id, item.range]), [['outer', { from: 2, to: 5 }]])
  expectRoundtrip(e, 'abcdefghij', original)
})

test('unresolved slash points stay before continuation but disappear with their text', () => {
  const original = [point(5, 'title'), point(5, 'tag')]
  const e = editor('abcdefghij', original)
  e.apply(e.state.tr.insertText('XX', 5))
  assert.deepEqual(e.markup.map(item => [item.anchor, item.range]), [[5, null], [5, null]])
  e.boundary()
  const before = e.markup
  e.apply(e.state.tr.delete(1, e.state.doc.content.size - 1))
  assert.equal(e.text, '')
  assert.deepEqual(e.markup, [])
  expectRoundtrip(e, 'abcdXXefghij', before)
})

test('unresolved slash tag maps edits before, at and after its point with joint Undo/Redo', () => {
  for (const [position, anchor] of [[3, 7], [5, 5], [7, 5]]) {
    const original = [point(5)]
    const e = editor('abcdefghij', original)
    e.apply(e.state.tr.insertText('XY', position))
    assert.deepEqual(e.markup, [{ ...original[0], anchor }])
    expectRoundtrip(e, 'abcdefghij', original)
  }
})

for (const kind of ['tag', 'title']) {
  for (const anchor of [6, 8, 10]) {
    for (const operation of ['paragraph-delete', 'content-delete', 'content-replace', 'paragraph-replace']) {
      test(`slash ${kind} at ${anchor}: ${operation} removes only its label, Undo/Redo restore both`, () => {
        const original = [point(anchor, kind), { ...point(13), id: 'independent' }]
        const e = editor('abc\ndefg\nhij', original)
        const doc = e.state.doc.toJSON()
        const tr = e.state.tr
        if (operation === 'paragraph-delete') tr.delete(5, 11)
        if (operation === 'content-delete') tr.delete(6, 10)
        if (operation === 'content-replace') tr.insertText('new', 6, 10)
        if (operation === 'paragraph-replace') tr.replaceWith(5, 11, e.state.schema.nodes.paragraph.create(null, e.state.schema.text('new')))
        const expectedAnchor = tr.mapping.map(13, -1)
        e.apply(tr)
        assert.deepEqual(e.markup, [{ ...original[1], anchor: expectedAnchor }])
        const changedDoc = e.state.doc.toJSON()
        expectRoundtrip(e, 'abc\ndefg\nhij', original)
        assert.deepEqual(e.state.doc.toJSON(), changedDoc)
        e.undo()
        assert.deepEqual(e.state.doc.toJSON(), doc)
      })
    }
  }
}

for (const [name, from, to, expected] of [
  ['earlier paragraph', 0, 5, 3],
  ['earlier text', 1, 3, 6],
  ['adjacent before point', 7, 8, 7],
  ['adjacent after point', 8, 9, 8],
  ['later paragraph', 11, 16, 8],
]) {
  test(`slash point survives deletion of ${name} with Undo/Redo`, () => {
    const original = [point(8)]
    const e = editor('abc\ndefg\nhij', original)
    e.apply(e.state.tr.delete(from, to))
    assert.deepEqual(e.markup, [{ ...original[0], anchor: expected }])
    expectRoundtrip(e, 'abc\ndefg\nhij', original)
  })
}

test('partial deletion across a slash point destroys it, and Undo restores it', () => {
  const original = [point(8)]
  const e = editor('abc\ndefg\nhij', original)
  e.apply(e.state.tr.delete(7, 9))
  assert.deepEqual(e.markup, [])
  expectRoundtrip(e, 'abc\ndefg\nhij', original)
})

test('empty paragraph point survives typing but not removal of its paragraph', () => {
  const original = [point(6)]
  const e = editor('abc\n\nhij', original)
  e.apply(e.state.tr.delete(5, 7))
  assert.deepEqual(e.markup, [])
  expectRoundtrip(e, 'abc\n\nhij', original)
})

test('each step uses its own original document when earlier edits shift the paragraph', () => {
  const original = [point(10)]
  const e = editor('abc\ndefg\nhij', original)
  e.apply(e.state.tr.insertText('prefix', 1).delete(12, 16).insertText('new', 12))
  assert.deepEqual(e.markup, [])
  expectRoundtrip(e, 'abc\ndefg\nhij', original)
})

test('selection assignment and removal are semantic-only Undo events and never insert service text', () => {
  const e = editor()
  e.select(3, 7)
  e.apply(assignSelectionMarkup(e.state, attrs()))
  assert.equal(e.text, 'abcdefghij')
  assert.deepEqual(e.markup, [selected()])
  expectRoundtrip(e, 'abcdefghij', [])
  e.apply(removeSemanticMarkup(e.state, 'tag'))
  assert.deepEqual(e.markup, [])
  expectRoundtrip(e, 'abcdefghij', [selected()])
})

test('confirmed slash deletion and metadata assignment undo together, isolated from typing on either side', () => {
  const e = editor('abc')
  e.apply(e.state.tr.insertText('/', 4))
  e.apply(confirmSlashMarkup(e.state, 4, attrs('title', 'title')))
  const assigned = e.markup
  assert.equal(e.text, 'abc')
  assert.equal(assigned[0].anchor, 4)
  assert.equal(assigned[0].range, null)
  e.apply(e.state.tr.insertText('next', 4))
  e.undo()
  assert.equal(e.text, 'abc')
  assert.deepEqual(e.markup, assigned)
  e.undo()
  assert.equal(e.text, 'abc/')
  assert.deepEqual(e.markup, [])
  e.undo()
  assert.equal(e.text, 'abc')
  e.redo(); e.redo(); e.redo()
  assert.equal(e.text, 'abcnext')
  assert.deepEqual(e.markup, assigned)
})

test('ordinary slash and hash input never creates or removes semantic data', () => {
  const e = editor('')
  const text = 'и/или 01/10 https://example.org / #заметки'
  e.apply(e.state.tr.insertText(text, 1))
  assert.equal(e.text, text)
  assert.deepEqual(e.markup, [])
  expectRoundtrip(e, '', [])
  assert.throws(() => confirmSlashMarkup(e.state, 1, attrs()), /нет символа/)
})

test('second slash boundary is explicit and undoable; empty sessions may hold semantic data', () => {
  const e = editor('/', [])
  e.apply(confirmSlashMarkup(e.state, 1, attrs()))
  assert.equal(e.text, '')
  assert.equal(e.markup[0].range, null)
  e.apply(e.state.tr.insertText('abc', 1))
  const before = e.markup
  e.apply(setSemanticRange(e.state, 'tag', { from: 1, to: 3 }))
  assert.equal(e.markup[0].source, 'slash')
  assert.deepEqual(e.markup[0].range, { from: 1, to: 3 })
  expectRoundtrip(e, 'abc', before)
  assert.throws(() => setSemanticRange(e.state, 'tag', null))
  assert.throws(() => setSemanticRange(e.state, 'tag', { from: 1, to: 99 }))
})

test('one multi-step transaction restores all text and labels including a deleted fragment', () => {
  const original = [selected(), point(8, 'title')]
  const e = editor('abcdefghij', original)
  const tr = e.state.tr.delete(3, 7).insertText('XYZ', 2)
  tr.addMark(1, 3, e.state.schema.marks.bold.create())
  e.apply(tr)
  assert.equal(e.markup.length, 1)
  const afterDoc = e.state.doc.toJSON()
  expectRoundtrip(e, 'abcdefghij', original)
  assert.deepEqual(e.state.doc.toJSON(), afterDoc)
})

test('paragraph split, join, hard break and pasted fragment map across structural edits', () => {
  for (const operation of ['split', 'join', 'break', 'paste']) {
    const text = operation === 'join' ? 'abcd\nefgh' : 'abcdefghij'
    const original = [selected(2, 8)]
    const e = editor(text, original)
    const tr = e.state.tr
    if (operation === 'split') tr.split(5)
    if (operation === 'join') tr.join(6)
    if (operation === 'break') tr.insert(5, e.state.schema.nodes.hardBreak.create())
    if (operation === 'paste') tr.replaceRange(4, 6, parseDocument(legacyToDocument('A\nB')).slice(1, 5))
    e.apply(tr)
    assert.equal(e.markup.length, 1)
    expectRoundtrip(e, text, original)
  }
})

test('formatting uses the same Undo history and does not change semantic positions', () => {
  const original = [selected()]
  const e = editor('abcdefghij', original)
  for (const mark of ['bold', 'italic', 'underline']) {
    e.boundary()
    e.apply(e.state.tr.addMark(2, 8, e.state.schema.marks[mark].create()))
    assert.deepEqual(e.markup, original)
  }
  e.undo(); e.undo(); e.undo()
  assert.deepEqual(e.state.doc.toJSON(), legacyToDocument('abcdefghij'))
  assert.deepEqual(e.markup, original)
  e.redo(); e.redo(); e.redo()
  assert.equal(e.state.doc.nodeAt(2).marks.length, 3)
})

test('history grouping, selection-only transactions and branching redo behave normally', () => {
  const e = editor('abcdefghij', [selected()])
  e.apply(e.state.tr.insertText('x', 4).setTime(100))
  e.apply(e.state.tr.insertText('y', 5).setTime(150))
  assert.equal(undoDepth(e.state), 1)
  e.select(1)
  assert.equal(undoDepth(e.state), 1)
  e.undo()
  assert.equal(e.text, 'abcdefghij')
  assert.deepEqual(e.markup, [selected()])
  assert.equal(redoDepth(e.state), 1)
  e.apply(e.state.tr.insertText('new', 1))
  assert.equal(redoDepth(e.state), 0)
})

test('new states isolate day/reload history and initial data and snapshots cannot mutate plugin state', () => {
  const initial = [selected()]
  const e = editor('abcdefghij', initial)
  initial[0].value = 'mutated'
  e.markup[0].range.from = 99
  assert.deepEqual(e.markup, [selected()])
  e.apply(e.state.tr.delete(3, 7))
  const nextDay = editor('')
  const reload = editor(e.text, e.markup)
  for (const fresh of [nextDay, reload]) {
    assert.equal(undoDepth(fresh.state), 0)
    assert.equal(undo(fresh.state), false)
  }
  // Reconfiguring presentation keeps the same history and plugin state.
  const reconfigured = e.state.reconfigure({ plugins: e.state.plugins })
  assert.equal(undoDepth(reconfigured), undoDepth(e.state))
  assert.deepEqual(getSemanticMarkup(reconfigured), e.markup)
})

test('adapter preserves metadata, time, selection, stored marks and scroll without mutating source', () => {
  const e = editor('abcdefghij', [selected()])
  const source = e.state.tr.insertText('x', 1).setMeta('composition', 7).setMeta('uiEvent', 'paste').setTime(123)
  source.setSelection(TextSelection.create(source.doc, 2)).setStoredMarks([e.state.schema.marks.bold.create()]).scrollIntoView()
  const result = trackSemanticTransaction(e.state, source)
  assert.equal(result.getMeta('composition'), 7)
  assert.equal(result.getMeta('uiEvent'), 'paste')
  assert.equal(result.time, 123)
  assert.equal(result.selection.from, 2)
  assert.deepEqual(result.storedMarks, source.storedMarks)
  assert.equal(result.scrolledIntoView, true)
  assert.ok(result.doc.eq(source.doc))
  assert.ok(!(source.steps[0] instanceof SemanticStep))
  assert.deepEqual(e.state.applyTransaction(source).state.doc.toJSON(), e.state.doc.toJSON())
})

test('tracked steps serialize and invert with the whole semantic snapshot', () => {
  const e = editor('abcdefghij', [selected()])
  const tr = trackSemanticTransaction(e.state, e.state.tr.delete(3, 7))
  const step = Step.fromJSON(e.state.schema, JSON.parse(JSON.stringify(tr.steps[0].toJSON())))
  assert.deepEqual(step.toJSON(), tr.steps[0].toJSON())
  const applied = step.apply(e.state.doc)
  assert.equal(applied.failed, null)
  const inverted = step.invert(e.state.doc)
  assert.ok(inverted.apply(applied.doc).doc.eq(e.state.doc))
  assert.deepEqual(inverted.after, [selected()])
})

test('history remaps snapshots through an unrecorded text insertion', () => {
  const e = editor('abcdefghij', [selected()])
  e.apply(e.state.tr.delete(4, 6))
  e.apply(e.state.tr.insertText('XX', 1).setMeta('addToHistory', false))
  e.undo()
  assert.equal(e.text, 'XXabcdefghij')
  assert.deepEqual(e.markup[0].range, { from: 5, to: 9 })
  e.redo()
  assert.equal(e.text, 'XXabcfghij')
  assert.deepEqual(e.markup[0].range, { from: 5, to: 7 })
})

test('semantic assignment preserves active typing marks and rejects stale semantic-only transactions', () => {
  const typing = editor('abc/')
  typing.select(5)
  typing.apply(typing.state.tr.setStoredMarks([typing.state.schema.marks.italic.create()]))
  typing.apply(confirmSlashMarkup(typing.state, 4, attrs()))
  assert.equal(typing.state.storedMarks[0].type.name, 'italic')
  const e = editor()
  e.select(3, 7)
  const stale = assignSelectionMarkup(e.state, attrs('stale'))
  e.apply(assignSelectionMarkup(e.state, attrs('current')))
  assert.throws(() => e.apply(stale), /Устаревшая/)
  assert.deepEqual(e.markup.map(item => item.id), ['current'])
  const bypass = removeSemanticMarkup(e.state, 'current').setMeta('addToHistory', false)
  e.apply(bypass)
  assert.deepEqual(e.markup.map(item => item.id), ['current'])
})

test('range and slash snapshots survive a deterministic sequence of edits, undo all and redo all', () => {
  const e = editor('abcdefghij', [selected(), point(4, 'title')])
  const snapshots = [{ doc: e.state.doc.toJSON(), markup: e.markup }]
  let seed = 117
  const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max }
  for (let i = 0; i < 40; i++) {
    e.boundary()
    const length = e.text.length
    const from = 1 + random(length + 1)
    if (i % 5 === 0 && length > 0) {
      e.select(1, Math.min(length + 1, 4))
      e.apply(assignSelectionMarkup(e.state, attrs(`label-${i}`, i % 2 ? 'title' : 'tag')))
    } else {
      const to = Math.min(length + 1, from + random(4))
      const insert = from === to || i % 3 ? 'xy'.slice(0, 1 + random(2)) : ''
      e.apply(e.state.tr.insertText(insert, from, to))
    }
    snapshots.push({ doc: e.state.doc.toJSON(), markup: e.markup })
  }
  for (let i = snapshots.length - 2; i >= 0; i--) {
    e.undo()
    assert.deepEqual({ doc: e.state.doc.toJSON(), markup: e.markup }, snapshots[i])
  }
  assert.equal(undoDepth(e.state), 0)
  for (let i = 1; i < snapshots.length; i++) {
    e.redo()
    assert.deepEqual({ doc: e.state.doc.toJSON(), markup: e.markup }, snapshots[i])
  }
})

test('history remaps restored ranges for unrecorded insertions before, inside and after the fragment', () => {
  for (const position of [1, 3, 4, 5, 8]) {
    const e = editor('abcdefghij', [selected()])
    e.apply(e.state.tr.delete(4, 6))
    e.apply(e.state.tr.insertText('X', position).setMeta('addToHistory', false))
    const beforeUndo = { text: e.text, markup: e.markup }
    e.undo()
    parseSemanticMarkup(e.markup, e.state.doc.content.size)
    assert.equal(e.markup.length, 1)
    e.redo()
    assert.deepEqual({ text: e.text, markup: e.markup }, beforeUndo)
  }
})
