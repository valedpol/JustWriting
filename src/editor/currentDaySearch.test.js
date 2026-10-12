import test from 'node:test'
import assert from 'node:assert/strict'
import { createWritingState } from './browserState.js'
import { currentDaySearch, revealDaySearchMatch } from './currentDaySearch.js'
import { legacyToDocument } from './document.js'
import { trackSemanticTransaction } from './semanticHistory.js'
import { searchDecorations } from './searchDecorations.js'

const semantic = (id, kind, value, from, to) => ({ id, valueId: id, kind, value, source: 'selection',
  direction: kind === 'title' ? 'forward' : 'backward', anchor: kind === 'title' ? from : to, range: { from, to } })

test('open-day search uses live PM content, literal archive normalization and independent text/title/tag occurrences without mutations', () => {
  const source = { content: 'Ёж один ёж. [a.*]', semanticMarkup: [semantic('title', 'title', 'ЁЖ название', 1, 3), semantic('tag', 'tag', 'Ёж тег', 4, 8)] }
  source.contentFormat = 'tiptap-json'; source.contentVersion = 1; source.document = legacyToDocument(source.content)
  const before = structuredClone(source)
  let state = createWritingState(source)
  state = state.apply(trackSemanticTransaction(state, state.tr.insertText(' ЕЖ', state.doc.content.size - 1)))
  const document = state.doc.toJSON(), selection = state.selection
  const found = currentDaySearch(state, 'еж')
  assert.deepEqual(found.map(item => item.entity), ['text', 'title', 'tag', 'text', 'text'])
  assert.equal(new Set(found.map(item => item.id)).size, 5)
  const title = found.find(item => item.entity === 'title')
  assert.equal(title.markupId, 'title')
  assert.equal(title.ranges, undefined)
  const tag = found.find(item => item.entity === 'tag')
  assert.equal(tag.markupId, 'tag')
  assert.equal(tag.ranges, undefined)
  const marks = searchDecorations(state.doc, found, tag.id).find()
  assert.equal(marks.length, 3)
  assert.ok(marks.every(mark => !mark.type.attrs.class.includes('is-current')), 'tag search never highlights its associated body range')
  assert.equal(currentDaySearch(state, '[a.*]').length, 1, 'regex characters are literal')
  assert.equal(currentDaySearch(state, 'нет такого').length, 0)
  assert.equal(currentDaySearch(state, '').length, 0)
  assert.equal(currentDaySearch(state, '   ').length, 0)
  assert.equal(currentDaySearch(state, ' ЕЖ ').length, 5, 'same trimmed query boundary as archive search UI')
  assert.deepEqual(state.doc.toJSON(), document)
  assert.equal(state.selection, selection)
  assert.deepEqual(source, before)
})

test('live search retains exact rich-document offsets across marks, paragraphs and hard breaks', () => {
  const state = createWritingState({ contentFormat: 'tiptap-json', contentVersion: 1, content: 'Ёж два\nтри\nЁж', semanticMarkup: [],
    document: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Ёж ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'два', marks: [{ type: 'italic' }] }, { type: 'hardBreak' }, { type: 'text', text: 'три' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Ёж', marks: [{ type: 'underline' }] }] },
    ] } })
  const before = state.doc.toJSON()
  const matches = currentDaySearch(state, 'еж два\nтри\nеж')
  assert.equal(matches.length, 1)
  assert.equal(matches[0].ranges.length, 2)
  assert.deepEqual(state.doc.toJSON(), before)
})

test('navigation scrolls only out-of-view actual match elements, including semantic labels, without selection or focus commands', () => {
  const scroller = { scrollTop: 100, closest: () => null, getBoundingClientRect: () => ({ top: 100, bottom: 400 }) }
  const match = (top, bottom) => ({ getBoundingClientRect: () => ({ top, bottom }) })
  revealDaySearchMatch(match(200, 220), scroller)
  assert.equal(scroller.scrollTop, 100)
  revealDaySearchMatch(match(450, 470), scroller)
  assert.equal(scroller.scrollTop, 178)
  revealDaySearchMatch(match(50, 70), scroller)
  assert.equal(scroller.scrollTop, 120)
  const metadata = { contains: () => true, getBoundingClientRect: () => ({ top: 150, bottom: 350 }) }
  revealDaySearchMatch(match(130, 145), scroller, metadata)
  assert.equal(scroller.scrollTop, 92, 'semantic navigation uses the rendered label bounds, not PM range positions')
})
