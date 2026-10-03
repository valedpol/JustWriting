import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import ReadonlyDocument from './ReadonlyDocument.js'
import ReadonlySemanticMarkup from './ReadonlySemanticMarkup.js'
import { legacyToDocument } from '../editor/document.js'

const render = (component, record) => new JSDOM(renderToStaticMarkup(createElement(component, { record }))).window.document.body
const rich = () => ({ contentFormat: 'tiptap-json', contentVersion: 1, content: 'stale projection', semanticMarkup: [], document: legacyToDocument('Первый\n\nПоследний\n') })

test('readonly rich renderer preserves marks, paragraphs, breaks and rules without editable DOM', () => {
  const record = rich()
  record.document.content[0].content[0].marks = [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }]
  record.document.content[0].content.push({ type: 'hardBreak' }, { type: 'text', text: '<script>alert(1)</script>' })
  record.document.content.splice(2, 0, { type: 'horizontalRule' })
  const before = structuredClone(record)
  const body = render(ReadonlyDocument, record)
  assert.equal(body.querySelectorAll('p').length, 4)
  assert.equal(body.querySelectorAll('hr').length, 1)
  assert.equal(body.querySelectorAll('br').length, 3)
  for (const mark of ['strong', 'em', 'u']) assert.equal(body.querySelector(mark).textContent, 'Первый')
  assert.equal(body.querySelector('script, input, textarea, [contenteditable]'), null)
  assert.ok(body.textContent.includes('<script>alert(1)</script>'))
  assert.ok(!body.textContent.includes('stale projection'))
  assert.deepEqual(record, before)
})

test('legacy archive preserves literal markup and whitespace without HTML or Markdown interpretation', () => {
  const record = { content: '**bold**\n\n__text__ #осень <img src=x onerror=alert(1)>\n' }
  const body = render(ReadonlyDocument, record)
  assert.equal(body.textContent, record.content)
  assert.equal(body.querySelector('img, strong, u'), null)
})

test('unsupported or damaged rich data shows an explicit safe text fallback; a rule is not empty', () => {
  for (const record of [{ ...rich(), contentVersion: 99 }, { ...rich(), document: { type: 'script' } }]) {
    const body = render(ReadonlyDocument, { ...record, content: '<script>fallback</script>' })
    assert.ok(body.querySelector('[role=status]'))
    assert.ok(body.textContent.includes('<script>fallback</script>'))
    assert.equal(body.querySelector('script'), null)
  }
  const record = rich()
  record.document = { type: 'doc', content: [{ type: 'horizontalRule' }] }
  assert.ok(render(ReadonlyDocument, record).querySelector('hr'))
  record.document = legacyToDocument('')
  assert.equal(render(ReadonlyDocument, record).textContent, 'Текст пуст.')
})

test('semantic metadata renders separately and safely; unresolved slash ranges remain valid', () => {
  const record = rich()
  record.semanticMarkup = [
    { id: '1', valueId: 't1', kind: 'tag', value: '<img src=x>', source: 'slash', anchor: 1, direction: 'backward', range: null },
    { id: '2', valueId: 't2', kind: 'title', value: 'Название', source: 'selection', anchor: 1, direction: 'forward', range: { from: 1, to: 4 } },
  ]
  const before = structuredClone(record)
  const body = render(ReadonlySemanticMarkup, record)
  assert.ok(body.textContent.includes('#<img src=x>'))
  assert.ok(body.textContent.includes('Название'))
  assert.equal(body.querySelector('img, [contenteditable], input'), null)
  assert.ok(!render(ReadonlyDocument, record).textContent.includes('Название'))
  assert.deepEqual(record, before)
  assert.equal(render(ReadonlySemanticMarkup, { content: '#legacy' }).textContent, '')
  record.semanticMarkup[0].anchor = 999
  assert.ok(render(ReadonlySemanticMarkup, record).querySelector('[role=status]'))
})

test('archive summary orders every title before compact tags and omits empty sections', () => {
  const record = rich()
  const item = (id, kind, value) => ({ id, valueId: id, kind, value, source: 'selection', anchor: kind === 'tag' ? 4 : 1,
    direction: kind === 'tag' ? 'backward' : 'forward', range: { from: 1, to: 4 } })
  record.semanticMarkup = [item('a', 'tag', 'идеи'), item('b', 'title', 'Офис'), item('c', 'tag', 'осень'), item('d', 'title', 'Вечер')]
  let body = render(ReadonlySemanticMarkup, record)
  assert.deepEqual([...body.querySelectorAll('.archive-semantic-title')].map(n => n.textContent), ["'Офис'", "  'Вечер'"])
  assert.equal(body.querySelector('.archive-semantic-tags').textContent, '#идеи #осень')
  assert.equal(body.textContent, "'Офис'  'Вечер'#идеи #осень")
  record.semanticMarkup = [item('b', 'title', 'Офис')]
  body = render(ReadonlySemanticMarkup, record)
  assert.equal(body.querySelector('.archive-semantic-tags'), null)
  assert.equal(body.querySelector('.archive-semantic-titles').textContent, "'Офис'")
  record.semanticMarkup = []
  assert.equal(render(ReadonlySemanticMarkup, record).textContent, '')
})

test('archive tags deduplicate by value in first appearance order without changing assignments', () => {
  const record = rich()
  record.semanticMarkup = ['JW', 'заметки', 'JW', 'диктофон', 'JW'].map((value, index) => ({
    id: String(index), valueId: `value-${index}`, kind: 'tag', value,
    source: 'selection', anchor: index + 1, direction: 'backward', range: { from: index + 1, to: index + 2 },
  }))
  const before = structuredClone(record)
  const body = render(ReadonlySemanticMarkup, record)
  assert.equal(body.querySelector('.archive-semantic-tags').textContent, '#JW #заметки #диктофон')
  assert.equal(body.querySelector('.archive-semantic-titles'), null)
  assert.deepEqual(record, before)
})

test('archive summary allows natural wrapping and keeps titles inline with their typography', () => {
  const css = readFileSync(new URL('../MyTexts.css', import.meta.url), 'utf8')
  const body = new JSDOM(`<style>${css}</style><div class="archive-day-label"><button><span>01.10.2026</span><span>1026 слов</span></button><div class="archive-semantic-markup"><div class="archive-semantic-titles"><span class="archive-semantic-title">'Длинное название'</span><span class="archive-semantic-title">  'Офис'</span></div><div class="archive-semantic-tags">#JW #заметки</div></div></div>`).window
  const style = selector => body.getComputedStyle(body.document.querySelector(selector))
  assert.equal(style('.archive-day-label > button').display, 'flex')
  assert.equal(style('.archive-day-label > button').gap, '16px')
  assert.equal(style('.archive-semantic-titles').whiteSpace, 'pre-wrap')
  assert.equal(style('.archive-semantic-title').display, 'inline')
  assert.equal(style('.archive-semantic-title').fontSize, '15px')
  assert.equal(style('.archive-semantic-title').fontWeight, '600')
  assert.equal(style('.archive-semantic-tags').whiteSpace, 'normal')
  assert.equal(style('.archive-semantic-markup').overflowWrap, 'anywhere')
})
