import 'fake-indexeddb/auto'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement, createRef, StrictMode } from 'react'

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'DOMParser', 'MutationObserver', 'getComputedStyle']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.ClipboardEvent = dom.window.Event
const rect = { top: 100, bottom: 120, left: 300, right: 310, width: 10, height: 20 }
dom.window.Range.prototype.getBoundingClientRect = () => rect
dom.window.Range.prototype.getClientRects = () => [rect]
dom.window.HTMLElement.prototype.getBoundingClientRect = () => rect
dom.window.HTMLElement.prototype.getClientRects = () => [rect]
dom.window.scrollBy = () => {}
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const { default: WritingEditor } = await server.ssrLoadModule('/src/components/WritingEditor.jsx')
const { openWritingController } = await server.ssrLoadModule('/src/editor/writingController.js')
const { getSemanticMarkup, confirmSlashMarkup, assignSelectionMarkup } = await server.ssrLoadModule('/src/editor/semanticHistory.js')
const { AllSelection, TextSelection } = await import('@tiptap/pm/state')
const { undo, redo } = await import('@tiptap/pm/history')
after(async () => { await server.close(); dom.window.close() })

test('titles immediately show exact readonly fragments with optional day context; tag cards, rereads and navigation never write stores', async () => {
  const { default: MyTexts } = await server.ssrLoadModule('/src/MyTexts.jsx')
  const { transaction } = await server.ssrLoadModule('/src/storage/database.js')
  const userId = crypto.randomUUID()
  const semantic = (id, kind, value, from, to) => ({ id, valueId: `value-${value}`, kind, value, source: 'selection',
    direction: kind === 'title' ? 'forward' : 'backward', anchor: kind === 'title' ? from : to, range: { from, to } })
  const content = 'Вступление\r\n' + 'Средняя строка\r\n'.repeat(12) + 'Конец дня и нужный фрагмент'
  const end = content.replace(/\r\n/g, '\n').indexOf('Конец дня') + 1
  const rows = [
    { dayKey: '2025-09-25', content, semanticMarkup: [semantic('z', 'title', 'Ясень', 1, 5), semantic('a', 'title', 'Ворона', end, end + 9), semantic('tag-a', 'tag', 'JW', end + 12, end + 18), semantic('tag-b', 'tag', 'JW', 1, 5)] },
    { dayKey: '2026-10-01', content: 'Азбука и нужный текст', semanticMarkup: [semantic('b', 'title', 'Азбука', 1, 7), semantic('tag-c', 'tag', 'JW', 11, 17)] },
    { dayKey: '2026-10-02', content: 'Другой фрагмент', semanticMarkup: [semantic('c', 'title', 'Ворона', 1, 7), semantic('tag-d', 'tag', 'Редкий', 8, 15)] },
  ].map(row => ({ ...row, textId: crypto.randomUUID(), userId, revision: 1 }))
  await transaction(['texts'], 'readwrite', tx => rows.forEach(row => tx.objectStore('texts').add(row)))
  const snapshot = () => transaction(['settings', 'texts', 'userDays', 'wordCountSamples', 'publications', 'publicationAnchors'], 'readonly', (tx, done) => {
    const data = {}; done(data)
    for (const name of ['settings', 'texts', 'userDays', 'wordCountSamples', 'publications', 'publicationAnchors']) {
      const read = tx.objectStore(name).getAll(); read.onsuccess = () => { data[name] = read.result }
    }
  })
  const before = await snapshot()
  const container = document.createElement('div'), sidebar = document.createElement('aside'), navigation = document.createElement('aside')
  document.body.append(container, sidebar, navigation)
  const root = createRoot(container)
  const nav = text => [...navigation.querySelectorAll('button')].find(node => node.textContent === text)
  const settle = async predicate => {
    for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
    assert.ok(predicate(), `${navigation.textContent}; ${container.textContent}`)
  }
  const originalRects = dom.window.Range.prototype.getClientRects
  dom.window.Range.prototype.getClientRects = function () {
    const top = (this.startContainer.parentElement?.closest('.archive-title-context') ? 800 : 200) - (container.querySelector('.archive-scroll')?.scrollTop ?? 0)
    return [{ ...rect, top, bottom: top + 20 }]
  }
  try {
    await act(async () => root.render(createElement(MyTexts, { userId, flush: async () => {}, onTotalWords() {}, metadataHost: sidebar, navigationHost: navigation })))
    await settle(() => container.querySelectorAll('[data-text-id]').length === 3)
    const area = container.querySelector('.archive-scroll')
    Object.defineProperty(area, 'clientHeight', { value: 600 })
    await click(container.querySelector('[aria-controls=archive-calendar]'))
    await click([...container.querySelectorAll('[aria-label=Годы] button')].find(node => node.textContent === '2026'))
    await settle(() => !nav('Поиск').disabled)
    await click(nav('Поиск'))
    await act(async () => {
      const input = navigation.querySelector('input')
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'Азбука')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => navigation.querySelector('form').requestSubmit())
    await settle(() => !navigation.querySelector('[aria-label="Найти"]').disabled && container.querySelectorAll('[data-text-id]').length === 1)
    await click(nav('←'))
    await settle(() => !nav('Названия').disabled)
    await click(nav('Названия'))
    const items = () => [...navigation.querySelectorAll('[data-semantic-item]')]
    const ids = () => [...container.querySelectorAll('[data-text-id]')].map(node => node.dataset.textId)
    const entry = id => container.querySelector(`[data-text-id="${id}"] .archive-preview-button`)
    const choose = id => click(navigation.querySelector(`[data-semantic-item="${id}"]`))
    const visibleText = () => {
      const node = container.querySelector('.ProseMirror')?.cloneNode(true)
      if (!node) return null
      node.querySelectorAll('.archive-title-hidden').forEach(node => node.remove())
      node.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
      return node.textContent
    }
    const context = label => click([...container.querySelectorAll('.archive-title-header button')].find(node => node.textContent === label))
    await settle(() => items().length === 4 && !items()[0].disabled)
    assert.deepEqual(items().map(node => node.firstElementChild.textContent), ['Азбука', 'Ворона', 'Ворона', 'Ясень'])
    assert.deepEqual(items().filter(node => node.firstElementChild.textContent === 'Ворона').map(node => node.querySelector('time').textContent), ['02.10.2026', '25.09.2025'])
    assert.equal(items()[0].getAttribute('aria-current'), 'true', 'first alphabetic title is selected automatically')
    assert.deepEqual(ids(), [rows[1].textId])
    await settle(() => visibleText() === 'Азбука')
    assert.equal(container.querySelector('.archive-preview-button'), null, 'named text is immediately open')
    const heading = navigation.querySelector('.archive-semantic-selector-heading')
    assert.equal(heading.firstElementChild.textContent, '←')
    assert.equal(heading.lastElementChild.textContent, 'Названия')
    assert.equal(navigation.querySelector('.archive-semantic-list-scroll').contains(heading), false)
    assert.equal(navigation.querySelectorAll('button').length, 5, 'one header back button, no bottom back item')
    await choose('a')
    await settle(() => !items()[0].disabled && visibleText() === 'Конец дня')
    assert.deepEqual(ids(), [rows[0].textId], 'a duplicate name selects its exact dated assignment')
    assert.equal(container.querySelector('[aria-label="Снять выбранный период"]'), null)
    assert.equal(container.querySelector('.archive-search-criterion'), null)
    assert.equal(container.querySelector('.ProseMirror').getAttribute('contenteditable'), 'false')
    await context('Весь день')
    await settle(() => container.querySelector('.archive-title-context') && !items()[0].disabled)
    assert.ok(visibleText().includes('Вступление'))
    assert.equal(container.querySelector('.archive-title-context').textContent, 'Конец дня')
    assert.ok(area.scrollTop > 0, 'context is positioned at the named fragment, not at the day start')
    await context('Только текст')
    await settle(() => visibleText() === 'Конец дня' && !items()[0].disabled)
    assert.equal(area.scrollTop, 0)
    area.scrollTop = 140
    await context('Весь день')
    await settle(() => container.querySelector('.archive-title-context') && !items()[0].disabled)
    assert.equal(area.scrollTop, 740, 'negative viewport offset is preserved when the title start is above the visible area')
    await context('Только текст')
    await settle(() => visibleText() === 'Конец дня' && !items()[0].disabled)
    assert.equal(area.scrollTop, 140, 'return retains the prior reading position instead of returning to the title start')
    await choose('c')
    await settle(() => visibleText() === 'Другой' && !items()[0].disabled)
    assert.deepEqual(ids(), [rows[2].textId])
    assert.equal(container.querySelector('.archive-title-context'), null, 'switching titles resets context mode')
    await click(nav('←'))
    await settle(() => nav('Теги') && !nav('Теги').disabled)
    assert.ok(container.querySelector('[aria-label="Снять выбранный период"]'), 'back restores the previous period')
    assert.ok(container.querySelector('.archive-search-criterion'), 'back restores the previous query')
    await click(nav('Теги'))
    await settle(() => items().length === 2 && !items()[0].disabled)
    assert.deepEqual(items().map(node => node.textContent), ['JW3', 'Редкий1'])
    assert.equal(items()[0].getAttribute('aria-current'), 'true', 'most frequent tag is selected automatically')
    assert.deepEqual(ids(), [rows[0].textId, rows[1].textId], 'multiple assignments in one day produce one standard card')
    await choose('Редкий')
    await settle(() => !items()[0].disabled && ids().length === 1)
    assert.deepEqual(ids(), [rows[2].textId])
    await click(entry(rows[2].textId))
    await settle(() => window.getSelection().toString() === 'фрагмен')
    assert.equal(document.activeElement.getAttribute('contenteditable'), 'false')
    await choose('JW')
    await settle(() => !items()[0].disabled && ids().length === 2)
    assert.equal(container.querySelector('.saved-text'), null, 'another selector choice resets cards to collapsed')
    assert.deepEqual(await snapshot(), before, 'navigation writes no text, metadata, publication, anchor, setting or sample')
    await click(nav('←'))
    await settle(() => nav('Названия') && !nav('Названия').disabled)
    await click(nav('Названия'))
    await settle(() => items().length === 4 && !items()[0].disabled)
    await choose('a')
    await settle(() => !items()[0].disabled && visibleText() === 'Конец дня')
    // Context toggles reread the source before showing a different presentation.
    const updated = { ...rows[0], revision: 2, content: 'Новый нужный фрагмент', semanticMarkup: [semantic('a', 'title', 'Ворона', 7, 13)] }
    await transaction(['texts'], 'readwrite', tx => tx.objectStore('texts').put(updated))
    const changed = await snapshot()
    await context('Весь день')
    await settle(() => visibleText() === updated.content && !items()[0].disabled)
    assert.equal(container.querySelector('.archive-title-context').textContent, 'нужный')
    assert.equal(container.querySelector('.ProseMirror').getAttribute('contenteditable'), 'false')
    assert.deepEqual(await snapshot(), changed)
    await context('Только текст')
    await settle(() => visibleText() === 'нужный' && !items()[0].disabled)
    await transaction(['texts'], 'readwrite', tx => tx.objectStore('texts').put({ ...updated, revision: 3, semanticMarkup: [] }))
    const removed = await snapshot()
    await context('Весь день')
    await settle(() => container.querySelector('[role=alert]'))
    await settle(() => visibleText() === 'Азбука')
    assert.deepEqual(ids(), [rows[1].textId], 'a removed choice falls back to the first available title')
    assert.deepEqual(await snapshot(), removed)
    await act(async () => root.render(null))
    await act(async () => root.render(createElement(MyTexts, { userId, flush: async () => {}, onTotalWords() {}, metadataHost: sidebar, navigationHost: navigation })))
    await settle(() => nav('Названия') && !nav('Названия').disabled)
    await click(nav('Названия'))
    await settle(() => items().length === 2 && !items()[0].disabled)
    assert.deepEqual(items().map(node => node.firstElementChild.textContent), ['Азбука', 'Ворона'])
    assert.equal(items()[0].getAttribute('aria-current'), 'true')
    assert.deepEqual(ids(), [rows[1].textId])
    await settle(() => visibleText() === 'Азбука')
    assert.deepEqual(await snapshot(), removed)
  } finally {
    dom.window.Range.prototype.getClientRects = originalRects
    await act(async () => root.unmount()); container.remove(); sidebar.remove(); navigation.remove()
  }
})

test('unfinished titles never invent a fragment or show the whole day until explicitly requested', async () => {
  const { default: MyTexts } = await server.ssrLoadModule('/src/MyTexts.jsx')
  const { transaction } = await server.ssrLoadModule('/src/storage/database.js')
  const { loadText } = await server.ssrLoadModule('/src/storage/textRepository.js')
  const record = { textId: crypto.randomUUID(), userId: crypto.randomUUID(), dayKey: '2026-10-01', revision: 1, content: 'Контекст без заданных границ.',
    semanticMarkup: [{ id: 'open', valueId: 'open-value', value: 'Начало', kind: 'title', source: 'slash', direction: 'forward', anchor: 1, range: null }] }
  await transaction(['texts'], 'readwrite', tx => tx.objectStore('texts').add(record))
  const container = document.createElement('div'), sidebar = document.createElement('aside'); document.body.append(container, sidebar)
  const root = createRoot(container)
  const settle = async predicate => {
    for (let i = 0; i < 80 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
    assert.ok(predicate(), container.textContent)
  }
  const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label)
  try {
    await act(async () => root.render(createElement(MyTexts, { userId: record.userId, flush: async () => {}, onTotalWords() {}, metadataHost: sidebar })))
    await settle(() => button('Названия') && !button('Названия').disabled)
    await click(button('Названия'))
    await settle(() => container.querySelector('.archive-title-unresolved'))
    assert.equal(container.querySelector('.saved-text'), null)
    assert.equal(sidebar.querySelector('[data-archive-date]').disabled, true)
    await click(button('Весь день'))
    await settle(() => container.querySelector('.ProseMirror') && button('Только текст') && !button('Только текст').disabled)
    assert.equal(container.querySelector('.ProseMirror').textContent, record.content)
    await click(button('Только текст'))
    await settle(() => container.querySelector('.archive-title-unresolved'))
    assert.equal(container.querySelector('.saved-text'), null)
    assert.deepEqual(await loadText(record.userId, record.dayKey), record)
  } finally { await act(async () => root.unmount()); container.remove(); sidebar.remove() }
})

test('readonly archive removes individual assignments and the last one persistently without changing historical fields', async () => {
  const { default: MyTexts } = await server.ssrLoadModule('/src/MyTexts.jsx')
  const { loadText } = await server.ssrLoadModule('/src/storage/textRepository.js')
  const { transaction } = await server.ssrLoadModule('/src/storage/database.js')
  const otherStores = () => transaction(['settings', 'userDays', 'wordCountSamples'], 'readonly', (tx, done) => {
    const result = {}
    for (const name of ['settings', 'userDays', 'wordCountSamples']) {
      const request = tx.objectStore(name).getAll()
      request.onsuccess = () => { result[name] = request.result }
    }
    done(result)
  })
  const writer = await openWritingController({ profile: { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 } })
  await writer.dispatch(writer.state.tr.insertText('Первый\n\nВторой текст', 1))
  await writer.dispatch(writer.state.tr.addMark(1, 4, writer.state.schema.marks.bold.create()))
  for (const [id, kind, from, to] of [['title', 'title', 1, 4], ['tag-a', 'tag', 1, 4], ['tag-b', 'tag', 5, 7]]) {
    await writer.dispatch(writer.state.tr.setSelection(TextSelection.create(writer.state.doc, from, to)))
    await writer.dispatch(assignSelectionMarkup(writer.state, { id, kind, valueId: kind, value: kind === 'tag' ? 'JW' : 'Офис' }))
  }
  const original = structuredClone(writer.snapshot.record)
  const beforeStores = await otherStores()
  const container = document.createElement('div'); document.body.append(container)
  const sidebar = document.createElement('aside'); document.body.append(sidebar)
  const root = createRoot(container)
  const props = { userId: original.userId, flush: () => writer.flush(), onTotalWords() {}, metadataHost: sidebar, onMetadataSaved: writer.adoptArchiveMetadata }
  const settle = async predicate => {
    for (let i = 0; i < 80 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
    assert.ok(predicate(), 'archive UI should settle')
  }
  const reload = async () => {
    await act(async () => root.render(null))
    await act(async () => root.render(createElement(MyTexts, props)))
    await settle(() => container.querySelector('.text-preview'))
    await click(container.querySelector('.text-preview').closest('button'))
    await settle(() => container.querySelector('.ProseMirror'))
    await act(async () => transaction(['publications'], 'readonly', (tx, done) => {
      const read = tx.objectStore('publications').getAll(); read.onsuccess = () => done(read.result)
    }))
  }
  try {
    await reload()
    await settle(() => sidebar.querySelectorAll('.semantic-remove').length === 3)
    assert.equal(sidebar.querySelector('.semantic-boundary'), null)
    await click(sidebar.querySelector('[aria-label="Удалить разметку JW"]'))
    await settle(() => sidebar.querySelectorAll('.semantic-remove').length === 2)
    let saved = await loadText(original.userId, original.dayKey)
    assert.deepEqual(saved, { ...original, semanticMarkup: original.semanticMarkup.filter(item => item.id !== 'tag-a'), revision: original.revision + 1 })
    await click(container.querySelector('.archive-record-info'))
    await settle(() => sidebar.querySelector('.archive-semantic-tags'))
    assert.equal(sidebar.querySelector('.archive-semantic-tags').textContent, '#JW')
    await reload()
    await settle(() => sidebar.querySelectorAll('.semantic-remove').length === 2)
    await click(sidebar.querySelector('[aria-label="Удалить разметку Офис"]'))
    await settle(() => sidebar.querySelectorAll('.semantic-remove').length === 1)
    await click(sidebar.querySelector('[aria-label="Удалить разметку JW"]'))
    await settle(() => sidebar.querySelectorAll('.semantic-remove').length === 0)
    saved = await loadText(original.userId, original.dayKey)
    assert.deepEqual(saved, { ...original, semanticMarkup: [], revision: original.revision + 3 })
    await reload()
    assert.equal(sidebar.querySelector('.semantic-value, .semantic-remove'), null)
    assert.equal(container.querySelector('.ProseMirror').getAttribute('contenteditable'), 'false')
    assert.ok(container.querySelector('.ProseMirror strong'))
    assert.deepEqual(await loadText(original.userId, original.dayKey), saved)
    assert.deepEqual(await otherStores(), beforeStores)
    assert.deepEqual(getSemanticMarkup(writer.state), [])
  } finally { await act(async () => root.unmount()); container.remove(); sidebar.remove() }
})

async function fixture(options = {}) {
  const controller = options.controller ?? await openWritingController({ profile: { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 } })
  const container = document.createElement('div'); document.body.append(container)
  const sidebar = document.createElement('aside'); document.body.append(sidebar)
  const ref = createRef()
  const root = createRoot(container)
  const render = async (writing = true, active = true) => act(async () => {
    root.render(createElement(WritingEditor, { ref, controller, writing, active, ready: true, metadataHost: sidebar, scrollElement: options.scrollElement, searchOccurrences: options.searchOccurrences, activeSearchId: options.activeSearchId, visibleRange: options.visibleRange, contextRange: options.contextRange, onActivate() {}, readonlyContent: options.readonlyContent ?? false }))
  })
  await render()
  return { controller, container, sidebar, ref, render, async close() { await act(async () => root.unmount()); container.remove(); sidebar.remove() } }
}

test('readonly title view preserves multi-paragraph B/I/U and source coordinates; Select All stays inside the visible range', async () => {
  const { createArchiveController } = await server.ssrLoadModule('/src/editor/archiveController.js')
  const { parseDocument, documentToContent } = await server.ssrLoadModule('/src/editor/document.js')
  const first = 'Первый абзац. '.repeat(60), second = 'Второй абзац. '.repeat(40)
  const document = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'До. ' }, { type: 'text', text: first, marks: [{ type: 'bold' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: second, marks: [{ type: 'italic' }, { type: 'underline' }] }, { type: 'text', text: ' После.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Хвост дня' }] },
  ] }
  const doc = parseDocument(document), range = { from: 5, to: doc.child(0).nodeSize + 1 + second.length }
  const record = { userId: crypto.randomUUID(), textId: crypto.randomUUID(), dayKey: '2026-10-01', revision: 1,
    contentFormat: 'tiptap-json', contentVersion: 1, document, content: documentToContent(document), semanticMarkup: [] }
  let writes = 0
  const controller = createArchiveController(record, { save: async () => { writes++; assert.fail('view changes must not save a projected document') } })
  const options = { controller, readonlyContent: true, visibleRange: range }
  const f = await fixture(options)
  const view = f.ref.current.instance
  const visible = () => {
    const clone = view.dom.cloneNode(true)
    clone.querySelectorAll('.archive-title-hidden').forEach(node => node.remove())
    return clone
  }
  try {
    assert.equal(visible().textContent, first + second)
    assert.equal(visible().querySelectorAll('p').length, 2)
    assert.equal(visible().querySelector('strong').textContent, first)
    assert.equal(visible().querySelector('em u').textContent, second)
    assert.deepEqual(view.state.doc.toJSON(), document, 'the editor keeps the full original source, not a copied fragment')
    await act(async () => {
      view.focus()
      view.dom.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    assert.equal(controller.state.selection.from, range.from)
    assert.equal(controller.state.selection.to, range.to)
    await act(async () => { view.dispatch(view.state.tr.insertText('Запрещено', range.from)); await controller.flush() })
    assert.deepEqual(view.state.doc.toJSON(), document, 'readonly protection still rejects character edits')
    options.visibleRange = null; options.contextRange = range
    await f.render()
    assert.equal(visible().textContent, doc.textContent)
    assert.equal(view.dom.querySelectorAll('.archive-title-context').length, 2)
    options.visibleRange = range; options.contextRange = null
    await f.render()
    assert.equal(visible().textContent, first + second)
    options.visibleRange = { from: 0, to: doc.content.size }
    await f.render()
    await act(async () => f.ref.current.toggleSelectAll())
    assert.equal(controller.state.selection.empty, false)
    await act(async () => f.ref.current.toggleSelectAll())
    assert.equal(controller.state.selection.empty, true, 'whole-document title ranges with structural bounds can also clear selection')
    assert.deepEqual(controller.snapshot.record, record)
    assert.equal(writes, 0)
  } finally { await f.close() }
})

test('archive dates select only day text; collapse zones and collapse-all preserve anchor without writes', async () => {
  const { default: MyTexts } = await server.ssrLoadModule('/src/MyTexts.jsx')
  const { listTexts } = await server.ssrLoadModule('/src/storage/textRepository.js')
  const { transaction } = await server.ssrLoadModule('/src/storage/database.js')
  const userId = crypto.randomUUID()
  const originals = ['2026-09-25', '2026-09-26', '2026-09-27'].map((dayKey, i) => ({
    textId: crypto.randomUUID(), userId, dayKey, revision: 1, content: `Текст дня ${i + 1}\nВторая строка`,
  }))
  await transaction(['texts'], 'readwrite', tx => originals.forEach(record => tx.objectStore('texts').add(record)))
  const before = await listTexts(userId)
  const readOtherStores = () => transaction(['settings', 'userDays', 'wordCountSamples'], 'readonly', (tx, done) => {
    const values = {}
    for (const name of ['settings', 'userDays', 'wordCountSamples']) {
      const request = tx.objectStore(name).getAll()
      request.onsuccess = () => { values[name] = request.result }
    }
    done(values)
  })
  const otherStoresBefore = await readOtherStores()
  const container = document.createElement('div'); document.body.append(container)
  const sidebar = document.createElement('aside'); document.body.append(sidebar)
  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect
  const originalElementFromPoint = document.elementFromPoint
  document.elementFromPoint = () => null
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.matches('.archive-calendar-heading, #archive-calendar .research-time') && this.closest('.my-texts')) {
      const expanded = container.querySelector('[aria-controls="archive-calendar"]')?.getAttribute('aria-expanded') === 'true'
      const bottom = this.matches('.archive-calendar-heading') ? 53 : expanded ? 173 : 53
      return { ...rect, top: bottom - 28, bottom, height: 28 }
    }
    if (this.classList.contains('archive-scroll')) return { ...rect, top: 100, bottom: 700, height: 600 }
    if (this.matches('li[data-text-id]')) {
      const siblings = [...this.parentElement.children]
      let top = 100 - container.querySelector('.archive-scroll').scrollTop + (parseFloat(this.parentElement.style.paddingTop) || 0)
      for (const sibling of siblings) {
        if (sibling === this) break
        top += (sibling.querySelector('.saved-text') ? 500 : 50) + 63
      }
      const height = this.querySelector('.saved-text') ? 500 : 50
      return { ...rect, top, bottom: top + height, height }
    }
    return originalRect.call(this)
  }
  const root = createRoot(container)
  const settle = async predicate => {
    for (let i = 0; i < 80 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
    assert.ok(predicate(), 'archive should settle')
  }
  const entries = () => [...container.querySelectorAll('li[data-text-id]')]
  try {
    await act(async () => root.render(createElement(MyTexts, { userId, flush: async () => {}, onTotalWords() {}, metadataHost: sidebar })))
    await settle(() => entries().length === 3)
    assert.equal(sidebar.querySelector('.archive-actions'), null)
    const area = container.querySelector('.archive-scroll')
    Object.defineProperty(area, 'clientHeight', { value: 600 })
    await click(sidebar.querySelector('.archive-day-label button'))
    await settle(() => entries()[0].querySelector('.ProseMirror'))
    assert.ok(sidebar.querySelector('.archive-actions button'))
    const date = sidebar.querySelector(`[data-archive-date="${originals[0].textId}"]`)
    await click(date)
    assert.equal(window.getSelection().toString(), entries()[0].querySelector('.ProseMirror').textContent)
    assert.ok(document.querySelector('[role="toolbar"]'))
    const selectedText = window.getSelection().toString()
    const selectedRange = window.getSelection().getRangeAt(0).cloneRange()
    const mirror = entries()[0].querySelector('.ProseMirror')
    const calendarToggle = container.querySelector('[aria-controls="archive-calendar"]')
    area.getBoundingClientRect = () => ({ ...rect, top: calendarToggle.getAttribute('aria-expanded') === 'true' ? 220 : 100, bottom: 700 })
    for (const expanded of [true, false, true, false]) {
      const mouseDown = new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
      await act(async () => {
        calendarToggle.dispatchEvent(mouseDown)
        calendarToggle.click()
      })
      assert.equal(mouseDown.defaultPrevented, true, 'calendar control must preserve editor focus and native selection')
      assert.equal(calendarToggle.getAttribute('aria-expanded'), String(expanded))
      assert.equal(document.activeElement, mirror)
      assert.equal(window.getSelection().toString(), selectedText)
      const range = window.getSelection().getRangeAt(0)
      assert.equal(range.startContainer, selectedRange.startContainer)
      assert.equal(range.startOffset, selectedRange.startOffset)
      assert.equal(range.endContainer, selectedRange.endContainer)
      assert.equal(range.endOffset, selectedRange.endOffset)
      const panelRectTop = Number.parseFloat(document.querySelector('[role="toolbar"]').style.top)
      const boundaryBottom = (container.querySelector('#archive-calendar .research-time') ?? container.querySelector('.archive-calendar-heading')).getBoundingClientRect().bottom
      assert.equal(panelRectTop, boundaryBottom + 8, 'panel follows calendar/header boundary instead of scroll viewport')
      assert.ok(panelRectTop + rect.height <= area.getBoundingClientRect().top - 4, 'complete panel remains in the free gap, above visible text')
    }
    await click(date)
    assert.ok(window.getSelection().isCollapsed)
    assert.equal(document.querySelector('[role="toolbar"]'), null)
    await click(date)
    const partial = document.createRange()
    const firstText = entries()[0].querySelector('.ProseMirror p').firstChild
    partial.setStart(firstText, 1); partial.setEnd(firstText, 4)
    await act(async () => {
      window.getSelection().removeAllRanges(); window.getSelection().addRange(partial)
      document.dispatchEvent(new dom.window.Event('selectionchange'))
    })
    await click(date)
    assert.equal(window.getSelection().toString(), entries()[0].querySelector('.ProseMirror').textContent)
    await act(async () => {
      window.getSelection().removeAllRanges()
      document.dispatchEvent(new dom.window.Event('selectionchange'))
    })
    assert.equal(document.querySelector('[role="toolbar"]'), null, 'native deselection must close stale readonly toolbar')
    await click(date)
    assert.ok(!window.getSelection().toString().includes('25.09.2026'))
    assert.equal(entries()[0].querySelector('.archive-record-info').textContent, '25.09.2026')
    assert.equal(entries()[0].querySelectorAll('.ProseMirror').length, 1)
    await click(entries()[0].querySelector('.ProseMirror'))
    assert.ok(entries()[0].querySelector('.ProseMirror'), 'text click must not collapse')
    await act(async () => { area.scrollTop = 120; area.dispatchEvent(new dom.window.Event('scroll')) })
    assert.equal(sidebar.querySelector('.archive-sticky-date').style.top, '0px')
    await act(async () => { area.scrollTop = 490; area.dispatchEvent(new dom.window.Event('scroll')) })
    assert.equal(sidebar.querySelector('.archive-sticky-date').style.top, '-10px', 'date must leave with its entry')
    assert.equal(sidebar.querySelector('.archive-collapse-strip'), null)
    await click(sidebar.querySelector('.archive-day-metadata'))
    assert.ok(entries()[0].querySelector('.ProseMirror'), 'blank right area does not collapse the record')
    await click(entries()[0].querySelector('.archive-record-header'))
    assert.equal(entries()[0].querySelector('.ProseMirror'), null)
    assert.equal(sidebar.querySelector('.archive-actions'), null)
    await click(entries()[0].querySelector('.archive-preview-button'))
    await settle(() => entries()[0].querySelector('.ProseMirror'))
    await click(entries()[0].querySelector('.archive-record-header'))
    assert.equal(entries()[0].querySelector('.ProseMirror'), null)

    // Expand two days, then work in the second one and preserve its row position.
    await click(entries()[0].querySelector('.archive-preview-button'))
    await click(entries()[1].querySelector('.archive-preview-button'))
    await settle(() => entries()[1].querySelector('.ProseMirror'))
    await click(sidebar.querySelector(`[data-archive-date="${originals[1].textId}"]`))
    await act(async () => document.dispatchEvent(new dom.window.Event('selectionchange')))
    assert.equal(window.getSelection().toString(), entries()[1].querySelector('.ProseMirror').textContent)
    assert.equal(document.querySelectorAll('[role="toolbar"]').length, 1, 'only the selected day owns a toolbar')
    await act(async () => { area.scrollTop = 400; area.dispatchEvent(new dom.window.Event('scroll')) })
    await click(entries()[1].querySelector('.ProseMirror'))
    const beforeTop = entries()[1].getBoundingClientRect().top
    assert.equal(container.querySelector('.archive-actions button'), null)
    assert.ok(sidebar.querySelector('.archive-actions button'))
    await click(sidebar.querySelector('.archive-actions button'))
    assert.equal(container.querySelector('.ProseMirror'), null)
    assert.equal(entries()[1].getBoundingClientRect().top, beforeTop)
    assert.ok(area.scrollTop >= 0, 'anchor must survive browser scroll clamping at the beginning')
    assert.equal(sidebar.querySelector('.archive-actions'), null)
    assert.deepEqual(await listTexts(userId), before)
    assert.deepEqual(await readOtherStores(), otherStoresBefore)
  } finally {
    await act(async () => root.unmount())
    dom.window.HTMLElement.prototype.getBoundingClientRect = originalRect
    if (originalElementFromPoint) document.elementFromPoint = originalElementFromPoint
    else delete document.elementFromPoint
    container.remove(); sidebar.remove()
  }
})
const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label)
const click = async node => {
  assert.ok(node, 'button must exist')
  await act(async () => { node.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })); node.click() })
}
async function inputQuery(value) {
  const input = document.querySelector('.semantic-picker input')
  assert.ok(input)
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}

test('WritingEditor retains one DOM editor, selection and history through mode changes and saved acknowledgements', async () => {
  const f = await fixture()
  const original = f.container.querySelector('.ProseMirror')
  await act(async () => {
    await f.controller.dispatch(f.controller.state.tr.insertText('Один два', 1))
    await f.controller.dispatch(f.controller.state.tr.setSelection(TextSelection.create(f.controller.state.doc, 1, 5)), 'selection')
  })
  const state = f.controller.state
  await f.render(false)
  await f.render(true)
  assert.equal(f.container.querySelector('.ProseMirror'), original)
  assert.equal(f.controller.state, state)
  assert.equal(original.textContent, 'Один два')
  await act(async () => { f.ref.current.focus(); await f.controller.flush() })
  await click(document.querySelector('button[aria-label="Жирный"]'))
  await act(async () => f.controller.flush())
  assert.equal(original.querySelector('strong').textContent, 'Один')
  await act(async () => { undo(f.controller.state, tr => f.controller.dispatch(tr)); await f.controller.flush() })
  assert.equal(original.querySelector('strong'), null)
  await act(async () => { redo(f.controller.state, tr => f.controller.dispatch(tr)); await f.controller.flush() })
  assert.ok(original.querySelector('strong'))
  await f.render(true, false)
  await f.render(true, true)
  assert.equal(f.container.querySelector('.ProseMirror'), original)
  await f.close()
})

test('slash category preview removes slash visually, cancellation restores it, confirmation and Undo remain atomic', async () => {
  const f = await fixture()
  const editor = f.container.querySelector('.ProseMirror')
  await act(async () => { f.ref.current.focus() })
  // A real PM text-input key path dispatches through WritingEditor, opening /.
  const view = f.ref.current.instance
  await act(async () => { view.dispatch(view.state.tr.insertText('/', 1)); await f.controller.flush() })
  assert.equal(f.controller.snapshot.text, '/')
  await click(button('Тег'))
  assert.equal(editor.textContent, '')
  await click(button('Отмена'))
  assert.equal(editor.textContent, '/')
  assert.equal(f.controller.snapshot.text, '/')
  await act(async () => { view.dispatch(view.state.tr.insertText('/', 2)); await f.controller.flush() })
  await click(button('Тег'))
  await inputQuery('заметки')
  await click(button('Создать «заметки»'))
  await act(async () => f.controller.flush())
  assert.equal(f.controller.snapshot.text, '/')
  assert.equal(getSemanticMarkup(f.controller.state)[0].value, 'заметки')
  assert.equal(getSemanticMarkup(f.controller.state)[0].range, null)
  assert.ok(f.sidebar.textContent.includes('#заметки'))
  await act(async () => { undo(f.controller.state, tr => f.controller.dispatch(tr)); await f.controller.flush() })
  assert.equal(f.controller.snapshot.text, '//')
  assert.deepEqual(getSemanticMarkup(f.controller.state), [])
  await f.close()
})

test('unresolved slash tag uses preceding text coordinates and remeasures after earlier insertion', async () => {
  const f = await fixture()
  try {
    const view = f.ref.current.instance
    // Model a soft wrap: the following side is on a lower visual line.
    view.coordsAtPos = (pos, side = 1) => ({ ...rect, top: 100 + pos * 10 + (side === 1 ? 20 : 0) })
    await act(async () => {
      await f.controller.dispatch(f.controller.state.tr.insertText('abc/', 1))
      await f.controller.dispatch(confirmSlashMarkup(f.controller.state, 4, {
        id: 'point', valueId: 'v', kind: 'tag', value: 'tag',
      }), 'slash-markup')
    })
    const top = () => f.sidebar.querySelector('.semantic-group').style.top
    assert.equal(top(), '40px')
    await act(async () => { await f.controller.dispatch(f.controller.state.tr.insertText('next', 4)) })
    assert.equal(top(), '40px')
    await act(async () => { await f.controller.dispatch(f.controller.state.tr.insertText('before', 1)) })
    assert.equal(top(), '100px')
  } finally { await f.close() }
})

test('same selection tags share a group; distinct ranges and unresolved points stay independent', async () => {
  const f = await fixture()
  try {
    const c = f.controller
    const attrs = id => ({ id, valueId: id, kind: 'tag', value: id })
    await act(async () => {
      await c.dispatch(c.state.tr.insertText('abcdef//', 1))
      await c.dispatch(c.state.tr.setSelection(TextSelection.create(c.state.doc, 1, 5)))
      await c.dispatch(assignSelectionMarkup(c.state, attrs('one')), 'semantic')
      await c.dispatch(assignSelectionMarkup(c.state, attrs('two')), 'semantic')
      // Same end/anchor, but a different start must not merge ranges.
      await c.dispatch(c.state.tr.setSelection(TextSelection.create(c.state.doc, 2, 5)))
      await c.dispatch(assignSelectionMarkup(c.state, attrs('other')), 'semantic')
      await c.dispatch(confirmSlashMarkup(c.state, 7, attrs('point-one')), 'slash-markup')
      await c.dispatch(confirmSlashMarkup(c.state, 7, attrs('point-two')), 'slash-markup')
    })
    const groups = () => [...f.sidebar.querySelectorAll('.semantic-group')]
    assert.deepEqual(groups().map(g => g.querySelectorAll('.semantic-label').length), [2, 1, 1, 1])
    assert.equal(groups()[0].style.top, '0px')
    assert.equal(groups()[1].style.top, '20px')
    // Simulate a wrapped group; the next group starts at its actual bottom.
    groups()[0].getBoundingClientRect = () => ({ ...rect, height: 110 })
    await act(async () => window.dispatchEvent(new dom.window.Event('resize')))
    assert.equal(groups()[1].style.top, '110px')
    await click(groups()[0].querySelector('.semantic-value'))
    assert.equal(c.state.selection.from, 1)
    assert.equal(c.state.selection.to, 5)
    await click(f.sidebar.querySelector('[aria-label="Удалить разметку one"]'))
    await act(async () => c.flush())
    assert.deepEqual(groups().map(g => g.querySelectorAll('.semantic-label').length), [1, 1, 1, 1])
    assert.equal(getSemanticMarkup(c.state).some(item => item.id === 'one'), false)
    assert.equal(getSemanticMarkup(c.state).some(item => item.id === 'two'), true)
    await act(async () => { undo(c.state, tr => c.dispatch(tr)); await c.flush() })
    assert.deepEqual(groups().map(g => g.querySelectorAll('.semantic-label').length), [2, 1, 1, 1])
  } finally { await f.close() }
})

for (const [name, upperY, lowerY, displayedY] of [
  ['no collision', 0, 50, 50],
  ['real collision', 0, 10, 20],
  ['touching edges', 0, 20, 20],
  ['above viewport', -30, -5, -5],
]) {
  test(`removing an independent upper group preserves the lower base position: ${name}`, async () => {
    const f = await fixture()
    try {
      const c = f.controller
      f.ref.current.instance.coordsAtPos = pos => ({ ...rect, top: 100 + (pos <= 2 ? upperY : lowerY) })
      await act(async () => {
        await c.dispatch(c.state.tr.insertText('abcdef', 1))
        for (const [id, from, to] of [['upper', 1, 2], ['lower', 3, 6]]) {
          await c.dispatch(c.state.tr.setSelection(TextSelection.create(c.state.doc, from, to)))
          await c.dispatch(assignSelectionMarkup(c.state, { id, valueId: id, kind: 'tag', value: id }), 'semantic')
        }
      })
      const lowerGroup = () => f.sidebar.querySelector('[aria-label="Удалить разметку lower"]').closest('.semantic-group')
      const doc = c.state.doc
      const lowerMarkup = getSemanticMarkup(c.state).find(item => item.id === 'lower')
      assert.equal(lowerGroup().style.top, `${displayedY}px`)
      assert.equal(f.sidebar.querySelector('.semantic-group').style.top, `${upperY}px`)
      await click(f.sidebar.querySelector('[aria-label="Удалить разметку upper"]'))
      await act(async () => c.flush())
      assert.equal(lowerGroup().style.top, `${lowerY}px`)
      assert.equal(c.state.doc, doc)
      assert.deepEqual(getSemanticMarkup(c.state), [lowerMarkup])
    } finally { await f.close() }
  })
}

for (const [name, anchor, head] of [['single line', 2, 3], ['multiple lines', 2, 9], ['backward', 9, 2]]) {
  test(`selection toolbar bottom follows first line: ${name}`, async () => {
    const f = await fixture()
    try {
      const c = f.controller
      const view = f.ref.current.instance
      let firstTop = 160
      view.coordsAtPos = pos => ({ ...rect, top: pos === 2 ? firstTop : 260, bottom: pos === 2 ? firstTop + 31 : 291 })
      await act(async () => {
        await c.dispatch(c.state.tr.insertText('abcdefghij', 1))
        await c.dispatch(c.state.tr.setSelection(TextSelection.create(c.state.doc, anchor, head)), 'selection')
        view.focus()
      })
      const toolbar = document.querySelector('[role="toolbar"]')
      assert.ok(toolbar)
      assert.equal(toolbar.style.top, '140px') // Actual default fixture height is 20px.
      let height = 47
      toolbar.getBoundingClientRect = () => ({ ...rect, height })
      await act(async () => window.dispatchEvent(new dom.window.Event('resize')))
      assert.equal(toolbar.style.top, '113px')
      for (const [mode, top, panelHeight] of [['wide', 210, 52], ['standard', 160, 47]]) {
        f.container.className = `app-shell screen-writing-${mode}`
        firstTop = top
        height = panelHeight
        await act(async () => window.dispatchEvent(new dom.window.Event('resize')))
        assert.equal(Number.parseFloat(toolbar.style.top) + height, firstTop)
      }
      firstTop = 10
      await act(async () => f.container.querySelector('.writing-scroll').dispatchEvent(new dom.window.Event('scroll')))
      assert.equal(toolbar.style.top, '-37px') // No clamp over the selection.
      await act(async () => {
        await c.dispatch(c.state.tr.setSelection(TextSelection.create(c.state.doc, 3, 8)), 'selection')
      })
      assert.equal(toolbar.style.top, '213px') // New first line, measured panel height.
      assert.deepEqual(getSemanticMarkup(c.state), [])
    } finally { await f.close() }
  })
}

for (const backward of [false, true]) {
  for (const [mark, label] of [['bold', 'Жирный'], ['italic', 'Курсив'], ['underline', 'Подчёркнутый']]) {
    test(`toolbar ${mark} preserves viewport and selection direction (${backward ? 'backward' : 'forward'}) through save`, async () => {
      const f = await fixture()
      try {
        const c = f.controller
        const view = f.ref.current.instance
        await act(async () => {
          await c.dispatch(c.state.tr.insertText('long selection '.repeat(300), 1))
          const end = c.state.doc.content.size - 1
          await c.dispatch(c.state.tr.setSelection(TextSelection.create(c.state.doc, backward ? end : 1, backward ? 1 : end)), 'selection')
          view.focus()
        })
        const selection = c.state.selection.toJSON()
        let requests = 0
        view.setProps({ handleScrollToSelection() { requests++; return true } })
        const scroller = f.container.querySelector('.writing-scroll')
        scroller.scrollTop = 123
        await click(document.querySelector(`button[aria-label="${label}"]`))
        assert.equal(requests, 0)
        assert.equal(scroller.scrollTop, 123)
        assert.deepEqual(c.state.selection.toJSON(), selection)
        assert.ok(c.state.doc.rangeHasMark(1, c.state.doc.content.size - 1, c.state.schema.marks[mark]))
        await act(async () => { await c.flush(); await c.check() })
        assert.equal(requests, 0)
        assert.equal(scroller.scrollTop, 123)
        assert.deepEqual(c.state.selection.toJSON(), selection)
        assert.equal(view.hasFocus(), true)
        await act(async () => { undo(c.state, tr => c.dispatch(tr)); await c.flush() })
        assert.equal(c.state.doc.rangeHasMark(1, c.state.doc.content.size - 1, c.state.schema.marks[mark]), false)
        assert.deepEqual(c.state.selection.toJSON(), selection)
        await act(async () => { redo(c.state, tr => c.dispatch(tr)); await c.flush() })
        assert.ok(c.state.doc.rangeHasMark(1, c.state.doc.content.size - 1, c.state.schema.marks[mark]))
        assert.deepEqual(c.state.selection.toJSON(), selection)
        // Explicit scroll requests outside toolbar formatting still reach ProseMirror.
        const before = requests
        await act(async () => { await c.dispatch(c.state.tr.scrollIntoView(), 'selection') })
        assert.ok(requests > before)
      } finally { await f.close() }
    })
  }
}

test('shared readonly editor offers metadata and guarded formatting while rejecting text edits', async () => {
  const writer = await openWritingController({ profile: { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 } })
  await writer.dispatch(writer.state.tr.insertText('Архивный текст', 1))
  const original = writer.snapshot.record
  const { createArchiveController } = await server.ssrLoadModule('/src/editor/archiveController.js')
  const archive = createArchiveController(original)
  const f = await fixture({ controller: archive, readonlyContent: true })
  try {
    const view = f.ref.current.instance
    assert.equal(view.dom.getAttribute('contenteditable'), 'false')
    await act(async () => {
      view.dom.focus()
      await archive.dispatch(archive.state.tr.setSelection(TextSelection.create(archive.state.doc, 1, 9)))
    })
    assert.ok(document.querySelector('button[aria-label="Жирный"]'))
    assert.deepEqual([...document.querySelectorAll('.editor-panel-row button')].map(node => node.textContent), ['B', 'I', 'U', 'Тег', 'Название', 'Опубликовать'])
    assert.equal(button('Copy'), undefined)
    await click(button('Название'))
    await inputQuery('Офис')
    await click(button('Создать «Офис»'))
    await act(async () => archive.flush())
    assert.equal(getSemanticMarkup(archive.state)[0].value, 'Офис')
    assert.equal(f.sidebar.querySelector('.semantic-value').textContent, 'Офис')
    await act(async () => window.getSelection().removeAllRanges())
    await click(f.sidebar.querySelector('.semantic-value'))
    assert.equal(window.getSelection().toString(), 'Архивный')
    assert.deepEqual(archive.snapshot.record.document, original.document)
    assert.equal(archive.snapshot.record.content, original.content)
    await act(async () => {
      view.dispatch(view.state.tr.insertText('bad'))
      view.dom.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }))
      view.dom.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }))
      await archive.flush()
    })
    assert.equal(archive.snapshot.record.content, original.content)
    assert.ok(view.dom.querySelector('strong'))
    const formatted = structuredClone(archive.snapshot.record.document)
    await act(async () => {
      view.dom.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
      await archive.flush()
    })
    assert.deepEqual(archive.snapshot.record.document, original.document)
    assert.equal(getSemanticMarkup(archive.state)[0].value, 'Офис')
    await act(async () => {
      view.dom.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
      await archive.flush()
    })
    assert.deepEqual(archive.snapshot.record.document, formatted)
    assert.equal(view.dom.getAttribute('contenteditable'), 'false')
  } finally { await f.close() }
})

test('ordinary continuation dismisses slash and manual hashtag remains author text', async () => {
  const f = await fixture()
  const view = f.ref.current.instance
  await act(async () => {
    f.ref.current.focus()
    view.dispatch(view.state.tr.insertText('/', 1))
    view.dispatch(view.state.tr.insertText(' #заметки и/или', 2))
    await f.controller.flush()
  })
  assert.equal(document.querySelector('.editor-panel'), null)
  assert.equal(f.controller.snapshot.text, '/ #заметки и/или')
  assert.deepEqual(getSemanticMarkup(f.controller.state), [])
  await f.close()
})

test('selection title and explicit second slash boundary are edited through the actual panels', async () => {
  const f = await fixture()
  const view = f.ref.current.instance
  await act(async () => {
    f.ref.current.focus()
    view.dispatch(view.state.tr.insertText('Начало', 1))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 7)))
    await f.controller.flush()
  })
  await click(button('Название'))
  await inputQuery('Глава')
  await click(button('Создать «Глава»'))
  await act(async () => f.controller.flush())
  assert.equal(getSemanticMarkup(f.controller.state)[0].source, 'selection')
  assert.deepEqual(getSemanticMarkup(f.controller.state)[0].range, { from: 1, to: 7 })
  await act(async () => {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)))
    view.dispatch(view.state.tr.insertText('/', 7))
    await f.controller.flush()
  })
  await click(button('Название'))
  await inputQuery('Далее')
  await click(button('Создать «Далее»'))
  await act(async () => {
    await f.controller.flush()
    view.dispatch(view.state.tr.insertText('Продолжение', 7))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 18)))
    await f.controller.flush()
  })
  assert.equal(getSemanticMarkup(f.controller.state)[1].range, null)
  await click(button('Граница здесь →'))
  await act(async () => f.controller.flush())
  assert.deepEqual(getSemanticMarkup(f.controller.state)[1].range, { from: 7, to: 18 })
  await act(async () => { undo(f.controller.state, tr => f.controller.dispatch(tr)); await f.controller.flush() })
  assert.equal(getSemanticMarkup(f.controller.state)[1].range, null)
  assert.equal(f.controller.snapshot.text, 'НачалоПродолжение')
  await f.close()
})

test('day phrase hook remains stable through rerenders/remounts and rotates only at the JW day boundary; mount is not auth', async () => {
  const { useDayPhrase } = await server.ssrLoadModule('/src/hooks/useDayPhrase.js')
  const { calculateUserDay } = await server.ssrLoadModule('/src/domain/writingDay.js')
  const profile = { userId: 'hook-owner', timeZone: 'Europe/Moscow', dayStartMinutes: 240 }
  const boundary = Date.parse('2026-10-08T01:00:00Z')
  const calls = [], saved = new Map()
  const api = {
    async loadDayPhrase(profile, now) {
      const { dayKey } = calculateUserDay({ ...profile, now })
      calls.push(dayKey)
      if (!saved.has(dayKey)) saved.set(dayKey, `Фраза ${saved.size + 1}`)
      return saved.get(dayKey)
    },
    chooseAfterAuthentication() { assert.fail('there is no real auth hook on local app mount') },
  }
  function Harness({ now, mode, userProfile }) {
    return createElement('p', { 'data-mode': mode }, useDayPhrase(userProfile, now, api))
  }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const render = async (now, mode = 'interface', userProfile = profile) => act(async () => root.render(createElement(StrictMode, null, createElement(Harness, { now, mode, userProfile }))))
  try {
    await render(boundary - 2000, 'interface', null)
    await render(boundary - 2000, 'interface', { userId: profile.userId })
    assert.equal(container.textContent, '')
    assert.equal(calls.length, 0, 'wait for the actual day policy; never guess timezone for incomplete profiles')
    await render(boundary - 2000)
    assert.equal(container.textContent, 'Фраза 1')
    const initialCalls = calls.length
    await render(boundary - 1000, 'writing')
    await render(boundary - 1, 'archive')
    assert.equal(container.textContent, 'Фраза 1')
    assert.equal(calls.length, initialCalls, 'ordinary renders/clock ticks/modes do not request a new choice')
    await act(async () => root.render(null))
    await render(boundary - 1)
    assert.equal(container.textContent, 'Фраза 1', 'remount/reopening retains the persisted selection')
    await render(boundary)
    assert.equal(container.textContent, 'Фраза 2')
    assert.equal(saved.size, 2)
  } finally { await act(async () => root.unmount()); container.remove() }
})

test('prompt follows editor state through typing, paste, line breaks and deleting all content', async () => {
  const f = await fixture()
  const view = f.ref.current.instance
  const isEmpty = () => view.dom.classList.contains('is-document-empty')
  const clear = async () => act(async () => {
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)).deleteSelection())
    await f.controller.flush()
  })
  try {
    assert.equal(isEmpty(), true, 'new empty document shows the prompt')
    await act(async () => { view.dispatch(view.state.tr.insertText('Я', 1)); await f.controller.flush() })
    assert.equal(isEmpty(), false, 'first letter hides the prompt')
    await clear()
    assert.equal(isEmpty(), true, 'deleting all content restores the prompt')
    await act(async () => { view.dispatch(view.state.tr.insertText(' ', 1)); await f.controller.flush() })
    assert.equal(isEmpty(), false, 'a typed space is user content')
    await clear()
    for (const html of ['<p>Начало<br>Конец</p>', '<p>Первый</p><p>Второй</p>']) {
      await act(async () => { assert.equal(view.pasteHTML(html), true); await f.controller.flush() })
      assert.equal(isEmpty(), false, `pasted content hides the prompt: ${html}`)
      if (html.includes('<br>')) {
        assert.ok(view.dom.querySelector('p:only-child > br:only-child'), 'reproduces the old false-empty DOM structure')
        assert.equal(view.state.doc.textContent, 'НачалоКонец')
      }
      await clear()
      assert.equal(isEmpty(), true)
    }
    for (const shiftKey of [false, true]) {
      await act(async () => {
        view.focus()
        view.dom.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, shiftKey, bubbles: true, cancelable: true }))
        await f.controller.flush()
      })
      assert.equal(isEmpty(), false, `${shiftKey ? 'Shift+Enter' : 'Enter'} is document content`)
      await clear()
      assert.equal(isEmpty(), true)
    }
  } finally { await f.close() }
})

test('prompt is derived again after reopening empty and nonempty saved days', async () => {
  const profile = { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 }
  const open = async () => fixture({ controller: await openWritingController({ profile }) })
  let f = await open()
  try {
    assert.ok(f.ref.current.instance.dom.classList.contains('is-document-empty'))
    await act(async () => {
      f.ref.current.instance.pasteHTML('<p>Сохранённый<br>текст</p>')
      await f.controller.flush()
    })
    const savedDoc = f.controller.state.doc.toJSON()
    await f.close()
    f = await open()
    assert.deepEqual(f.controller.state.doc.toJSON(), savedDoc)
    assert.equal(f.ref.current.instance.dom.classList.contains('is-document-empty'), false)
    await act(async () => {
      const view = f.ref.current.instance
      view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)).deleteSelection())
      await f.controller.flush()
    })
    await f.close()
    f = await open()
    assert.equal(f.controller.state.doc.textContent, '')
    assert.ok(f.ref.current.instance.dom.classList.contains('is-document-empty'))
  } finally { await f.close() }
})

test('IME DOM event bridge waits for the final transaction and ignores repeated completion notifications', async () => {
  const f = await fixture()
  const view = f.ref.current.instance
  await act(async () => {
    view.focus()
    view.dom.dispatchEvent(new dom.window.CompositionEvent('compositionstart', { bubbles: true }))
    view.dispatch(view.state.tr.insertText('n', 1).setMeta('composition', 1))
    view.dispatch(view.state.tr.insertText('你', 1, 2).setMeta('composition', 1))
  })
  assert.equal(f.controller.composing, true)
  assert.equal(f.controller.snapshot.record, null)
  assert.equal(view.dom.classList.contains('is-document-empty'), false, 'provisional IME text already hides the prompt')
  await act(async () => {
    view.dom.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true, data: '你' }))
    view.dom.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertFromComposition', data: '你' }))
    await new Promise(resolve => setTimeout(resolve, 60))
    await f.controller.flush()
  })
  assert.equal(f.controller.snapshot.text, '你')
  assert.equal(view.dom.classList.contains('is-document-empty'), false)
  const revision = f.controller.snapshot.record.revision
  await act(async () => {
    view.dom.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true, data: '你' }))
    await new Promise(resolve => setTimeout(resolve, 40))
  })
  assert.equal(f.controller.snapshot.record.revision, revision)
  assert.equal(f.controller.snapshot.text, '你')
  await f.close()
})

test('paste uses the safe schema, and rapid rule conversion keeps its original Undo behavior in the main view', async () => {
  const f = await fixture()
  const view = f.ref.current.instance
  await act(async () => {
    view.focus()
    assert.equal(view.pasteHTML('<p><b>Bold</b><i>Italic</i><u>Under</u><br>Line</p><h1>Next</h1><img src=x><script>bad()</script>'), true)
    await f.controller.flush()
  })
  const dom = view.dom
  assert.ok(dom.querySelector('strong'))
  assert.ok(dom.querySelector('em'))
  assert.ok(dom.querySelector('u'))
  assert.ok(dom.querySelector('br'))
  assert.equal(dom.querySelector('img, script, h1'), null)
  await act(async () => {
    view.dispatch(view.state.tr.delete(0, view.state.doc.content.size))
    for (let i = 0; i < 4; i++) {
      const { from, to } = view.state.selection
      view.someProp('handleTextInput', handler => handler(view, from, to, '-', () => view.state.tr.insertText('-')))
    }
    await f.controller.flush()
  })
  assert.ok(view.dom.querySelector('hr'))
  await act(async () => { undo(f.controller.state, tr => f.controller.dispatch(tr)); await f.controller.flush() })
  assert.equal(f.controller.snapshot.text, '----')
  await f.close()
})

test('main JW screen enters writing, keeps the editor across standard/wide and opens a readonly rich archive', async () => {
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const settle = async predicate => {
    for (let i = 0; i < 80 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
    assert.ok(predicate(), `UI should settle: ${container.textContent}; editor=${container.querySelector('.ProseMirror')?.outerHTML}`)
  }
  try {
    await act(async () => root.render(createElement(App)))
    await settle(() => container.querySelector('.ProseMirror'))
    await settle(() => container.querySelector('.quote-box p')?.textContent)
    const dayPhrase = container.querySelector('.quote-box p').textContent
    const { dayPhrases } = await server.ssrLoadModule('/src/storage/dayPhraseRepository.js')
    assert.ok(dayPhrases.includes(dayPhrase))
    const editor = container.querySelector('.ProseMirror')
    assert.equal(editor.getAttribute('contenteditable'), 'false')
    await click(container.querySelector('.meta-countdown'))
    await settle(() => container.querySelector('.screen-writing-standard'))
    await click(container.querySelector('button[aria-label="Таймер письма"]'))
    await settle(() => document.querySelector('[aria-label="Количество минут"]'))
    await act(async () => {
      const input = document.querySelector('[aria-label="Количество минут"]')
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, '1')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => document.querySelector('#writing-timer-setup').requestSubmit())
    await settle(() => document.activeElement === editor && document.querySelector('[role=timer]'))
    assert.equal(window.getSelection().anchorOffset, 0, 'empty-day timer focuses the first text position')
    await click(container.querySelector('.brand-block'))
    await act(async () => {
      editor.focus()
      editor.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'А', bubbles: true, cancelable: true }))
    })
    await settle(() => editor.textContent === 'А' && container.textContent.includes('Сохранено'))
    assert.ok(container.querySelector('.screen-writing-standard'))
    await act(async () => {
      editor.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))
      editor.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    await settle(() => editor.querySelector('strong'))
    const magnifier = () => container.querySelector('[aria-label="Поиск по текущему дню"]')
    await click(magnifier())
    await settle(() => document.querySelector('[aria-label="Найти в текущем дне"]'))
    await act(async () => {
      const search = document.querySelector('[aria-label="Найти в текущем дне"]')
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(search, 'а')
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(editor.querySelector('.archive-search-match').textContent, 'А')
    assert.equal(magnifier().getAttribute('aria-expanded'), 'true')
    await click(magnifier())
    assert.equal(document.querySelector('.day-search'), null)
    assert.equal(editor.querySelector('.archive-search-match'), null)
    await click(container.querySelector('button[aria-label="Перейти в широкий режим"]'))
    await settle(() => container.querySelector('.screen-writing-wide'))
    assert.equal(container.querySelector('.ProseMirror'), editor)
    assert.equal(container.querySelector('.quote-box p').textContent, dayPhrase)
    await click(container.querySelector('button[aria-label="Перейти в стандартный режим"]'))
    assert.equal(container.querySelector('.ProseMirror'), editor)
    await click(button('Архив и избранное'))
    await settle(() => container.querySelector('.text-preview'))
    assert.equal(container.querySelector('.quote-box p').textContent, dayPhrase, 'section navigation retains the day phrase')
    assert.equal(container.querySelector('.today-editor-shell').hidden, true)
    const localNavigation = container.querySelector('nav[aria-label="Архив и избранное"]')
    assert.ok(localNavigation)
    assert.equal(localNavigation.querySelector('span.menu-item').textContent, 'Архив и избранное')
    assert.equal(container.querySelector('nav[aria-label="Главное меню"]'), null)
    assert.deepEqual([...localNavigation.querySelectorAll('button')].map(node => node.textContent.trim()), ['Поиск по архиву', 'Названия', 'Теги', 'Коллекция', '←'])
    assert.equal([...localNavigation.querySelectorAll('button')].find(n => n.textContent === 'Коллекция').disabled, true)
    assert.ok(container.querySelector('.archive-calendar-heading'), 'calendar remains in the archive at its existing location')
    await click(container.querySelector('.text-preview').closest('button'))
    await settle(() => container.querySelector('.saved-text strong'))
    assert.equal(container.querySelector('.saved-text strong').textContent, 'А')
    assert.equal(container.querySelector('.saved-text [contenteditable=true]'), null)
    assert.ok(container.querySelector('.saved-text [contenteditable=false]'))
    await click(container.querySelector('[aria-label="Выйти из Моих текстов к Тексту сегодня"]'))
    assert.equal(container.querySelector('nav[aria-label="Архив и избранное"]'), null)
    assert.ok(container.querySelector('nav[aria-label="Главное меню"]'))
    assert.equal(container.querySelector('.ProseMirror'), editor)
    assert.equal(editor.getAttribute('contenteditable'), 'false')
  } finally { await act(async () => root.unmount()); container.remove() }
})

test('timer/search settings are mutually exclusive; starting from wide mode focuses the existing text end without changing source', async () => {
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  const { transaction } = await server.ssrLoadModule('/src/storage/database.js')
  const stores = ['settings', 'texts', 'userDays', 'wordCountSamples', 'publications', 'publicationAnchors']
  const snapshot = () => transaction(stores, 'readonly', (tx, done) => {
    const result = {}; done(result)
    for (const name of stores) {
      const read = tx.objectStore(name).getAll()
      read.onsuccess = () => {
        // Normal editor focus updates the clock-safety heartbeat independently
        // of the tools. Compare all actual settings/content/session fields.
        result[name] = name === 'settings' ? read.result.map(row => {
          if (row.key !== 'localProfile') return row
          const copy = { ...row }; delete copy.lastObservedAt; return copy
        }) : read.result
      }
    }
  })
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const settle = async predicate => {
    for (let i = 0; i < 80 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
    assert.ok(predicate(), container.textContent)
  }
  const fill = async (selector, value) => act(async () => {
    const input = document.querySelector(selector)
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  try {
    await act(async () => root.render(createElement(App)))
    await settle(() => container.querySelector('.ProseMirror') && container.textContent.includes('Сохранено'))
    const editor = container.querySelector('.ProseMirror'), content = editor.innerHTML
    assert.ok(editor.textContent.length > 0)
    await click(container.querySelector('.meta-countdown'))
    await settle(() => container.querySelector('.screen-writing-standard'))
    const before = await snapshot()
    const search = () => container.querySelector('[aria-label="Поиск по текущему дню"]')
    const timer = () => container.querySelector('button[aria-label="Таймер письма"]')
    await click(search())
    await fill('[aria-label="Найти в текущем дне"]', 'а')
    assert.ok(editor.querySelector('.archive-search-match'))
    await click(timer())
    assert.equal(document.querySelector('#quick-day-search'), null)
    assert.equal(editor.querySelector('.archive-search-match'), null)
    await fill('[aria-label="Количество минут"]', '25')
    await click(search())
    assert.equal(document.querySelector('#writing-timer-setup'), null)
    assert.equal(document.querySelector('[aria-label="Найти в текущем дне"]').value, '')
    await click(timer())
    assert.equal(document.querySelector('[aria-label="Количество минут"]').value, '')
    await click(timer())
    assert.equal(document.querySelector('#writing-timer-setup'), null)
    await click(container.querySelector('[aria-label="Перейти в широкий режим"]'))
    await click(timer())
    await fill('[aria-label="Количество минут"]', '120')
    await act(async () => document.querySelector('#writing-timer-setup').requestSubmit())
    await settle(() => document.activeElement === editor && container.querySelector('.screen-writing-standard'))
    assert.equal(document.querySelector('[role=timer]').textContent, '120:00')
    assert.equal(document.querySelector('#writing-timer-setup'), null)
    const selection = window.getSelection(), range = document.createRange()
    range.selectNodeContents(editor); range.setEnd(selection.anchorNode, selection.anchorOffset)
    assert.equal(range.toString(), editor.textContent, 'caret is at the end of the existing snapshot')
    assert.equal(editor.innerHTML, content)
    assert.deepEqual(await snapshot(), before, 'timer actions do not write any store or alter the daily goal')
  } finally { await act(async () => root.unmount()); container.remove() }
})

test('archive summary, native readonly selection assignment, collapse/reopen and reload share persisted metadata', async () => {
  const { default: MyTexts } = await server.ssrLoadModule('/src/MyTexts.jsx')
  const { loadText } = await server.ssrLoadModule('/src/storage/textRepository.js')
  const writer = await openWritingController({ profile: { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 } })
  await writer.dispatch(writer.state.tr.insertText('Архивный текст', 1))
  await writer.dispatch(writer.state.tr.setSelection(TextSelection.create(writer.state.doc, 1, 9)))
  await writer.dispatch(assignSelectionMarkup(writer.state, { id: 'tag', kind: 'tag', valueId: 't', value: 'идеи' }))
  await writer.dispatch(assignSelectionMarkup(writer.state, { id: 'title', kind: 'title', valueId: 'h', value: 'Офис' }))
  const original = writer.snapshot.record
  const container = document.createElement('div'); document.body.append(container)
  const sidebar = document.createElement('aside'); document.body.append(sidebar)
  const root = createRoot(container)
  const props = { userId: original.userId, flush: () => writer.flush(), onTotalWords() {}, metadataHost: sidebar, onMetadataSaved: writer.adoptArchiveMetadata }
  const settle = async predicate => {
    for (let i = 0; i < 80 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
    assert.ok(predicate(), 'archive UI should settle')
  }
  try {
    await act(async () => root.render(createElement(MyTexts, props)))
    await settle(() => sidebar.querySelector('.archive-semantic-tags'))
    const summary = sidebar.querySelector('.archive-day-label')
    const date = original.dayKey.split('-').reverse().join('.')
    assert.equal(summary.textContent, `${date}2 слов'Офис'#идеи`)
    await click(container.querySelector('.text-preview').closest('button'))
    await settle(() => container.querySelector('.ProseMirror') && sidebar.querySelector('.semantic-value'))
    assert.equal(sidebar.querySelector('.archive-semantic-markup'), null)
    assert.ok(container.querySelector('.archive-record-info').textContent.includes(date))
    const editor = container.querySelector('.ProseMirror')
    assert.equal(editor.getAttribute('contenteditable'), 'false')
    await act(async () => {
      editor.focus()
      const text = editor.querySelector('p').firstChild
      window.getSelection().setBaseAndExtent(text, 0, text, 8)
      document.dispatchEvent(new dom.window.Event('selectionchange'))
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    await settle(() => button('Тег'))
    await click(button('Тег'))
    await inputQuery('осень')
    await click(button('Создать «осень»'))
    await settle(() => sidebar.textContent.includes('#осень'))
    assert.equal(editor.textContent, original.content)
    await click(container.querySelector('.archive-record-info'))
    await settle(() => sidebar.querySelector('.archive-semantic-tags'))
    assert.equal(sidebar.querySelector('.archive-semantic-tags').textContent, '#идеи #осень')
    await click(container.querySelector('.text-preview').closest('button'))
    await settle(() => sidebar.querySelectorAll('.semantic-value').length === 3)
    await act(async () => root.render(null))
    await act(async () => root.render(createElement(MyTexts, props)))
    await settle(() => sidebar.querySelector('.archive-semantic-tags'))
    assert.equal(sidebar.querySelector('.archive-semantic-tags').textContent, '#идеи #осень')
    const saved = await loadText(original.userId, original.dayKey)
    assert.deepEqual(saved.document, original.document)
    assert.equal(saved.content, original.content)
    assert.equal(saved.revision, original.revision + 1)
    assert.equal(getSemanticMarkup(writer.state).length, 3)
  } finally { await act(async () => root.unmount()); container.remove(); sidebar.remove() }
})

for (const [mark, label] of [['bold', 'Жирный'], ['italic', 'Курсив'], ['underline', 'Подчёркнутый']]) {
  test(`archive ${mark} button follows first character, keeps selection and readonly DOM through persistence`, async () => {
    const writer = await openWritingController({ profile: { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 } })
    await writer.dispatch(writer.state.tr.insertText(' first last ', 1))
    await writer.dispatch(writer.state.tr.addMark(8, 12, writer.state.schema.marks[mark].create()))
    const { createArchiveController } = await server.ssrLoadModule('/src/editor/archiveController.js')
    const archive = createArchiveController(writer.snapshot.record)
    const f = await fixture({ controller: archive, readonlyContent: true })
    try {
      const original = structuredClone(archive.snapshot.record)
      await act(async () => {
        f.ref.current.selectAll()
        await archive.flush()
      })
      const selection = archive.state.selection.toJSON()
      const tools = () => document.querySelector(`button[aria-label="${label}"]`)
      assert.equal(tools().getAttribute('aria-pressed'), 'false')
      await click(tools())
      await act(async () => archive.flush())
      assert.equal(tools().getAttribute('aria-pressed'), 'true')
      assert.deepEqual(archive.state.selection.toJSON(), selection)
      assert.equal(archive.snapshot.record.content, original.content)
      assert.equal(f.ref.current.instance.dom.getAttribute('contenteditable'), 'false')
      assert.equal(window.getSelection().toString(), original.content)
      archive.state.doc.descendants(node => { if (node.isText) assert.ok(archive.state.schema.marks[mark].isInSet(node.marks)) })
      await click(tools())
      await act(async () => archive.flush())
      assert.equal(archive.state.doc.rangeHasMark(1, archive.state.doc.content.size - 1, archive.state.schema.marks[mark]), false)
      assert.equal(archive.snapshot.record.content, original.content)
      await act(async () => {
        window.getSelection().removeAllRanges()
        document.dispatchEvent(new dom.window.Event('selectionchange'))
      })
      assert.equal(document.querySelector('[role=toolbar]'), null)
    } finally { await f.close() }
  })
}

test('one presentation capability hides editing tools but keeps saved marks and semantic labels visible', async () => {
  const writer = await openWritingController({ profile: { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 } })
  await writer.dispatch(writer.state.tr.insertText('Архив', 1))
  await writer.dispatch(writer.state.tr.addMark(1, 6, writer.state.schema.marks.bold.create()))
  await writer.dispatch(writer.state.tr.setSelection(TextSelection.create(writer.state.doc, 1, 6)))
  await writer.dispatch(assignSelectionMarkup(writer.state, { id: 'keep', kind: 'tag', valueId: 'keep', value: 'keep' }))
  const { createArchiveController } = await server.ssrLoadModule('/src/editor/archiveController.js')
  const archive = createArchiveController(writer.snapshot.record, { canChangePresentation: () => false })
  const f = await fixture({ controller: archive, readonlyContent: true })
  try {
    await act(async () => f.ref.current.selectAll())
    assert.equal(document.querySelector('[role=toolbar]'), null)
    assert.ok(f.container.querySelector('strong'))
    assert.equal(f.sidebar.querySelector('.semantic-value').textContent, '#keep')
    assert.equal(f.sidebar.querySelector('.semantic-remove'), null)
    const original = structuredClone(archive.snapshot.record)
    await act(async () => f.ref.current.instance.dom.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true })))
    assert.deepEqual(archive.snapshot.record, original)
  } finally { await f.close() }
})

test('maintenance from another tab blocks archive formatting without changing the saved record', async () => {
  const writer = await openWritingController({ profile: { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 } })
  await writer.dispatch(writer.state.tr.insertText('Архив', 1))
  const { createArchiveController } = await server.ssrLoadModule('/src/editor/archiveController.js')
  const archive = createArchiveController(writer.snapshot.record)
  const f = await fixture({ controller: archive, readonlyContent: true })
  const markerKey = 'just-writing-explicit-maintenance'
  try {
    await act(async () => f.ref.current.selectAll())
    assert.ok(document.querySelector('[role=toolbar]'))
    const original = structuredClone(archive.snapshot.record)
    dom.window.localStorage.setItem(markerKey, JSON.stringify({ token: 'other-tab', owner: 'other', phase: 'maintenance' }))
    await f.render()
    assert.equal(document.querySelector('[role=toolbar]'), null)
    assert.throws(() => archive.dispatch(archive.state.tr.addMark(1, 6, archive.state.schema.marks.bold.create())), /Maintenance/)
    assert.deepEqual(archive.snapshot.record, original)
  } finally { dom.window.localStorage.removeItem(markerKey); await f.close() }
})

function pointerEvent(type, pointerId = 1) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries({ button: 0, pointerId, isPrimary: true, pointerType: 'mouse' })) Object.defineProperty(event, key, { value })
  return event
}

for (const [name, backwards, long] of [
  ['short downward', false, false], ['short upward', true, false],
  ['long downward with scroll', false, true], ['long upward with scroll', true, true],
]) {
  test(`archive pointer selection ${name}: native drag stays free, toolbar waits for release`, async () => {
    const writer = await openWritingController({ profile: { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 } })
    const content = long ? 'Длинный архивный текст '.repeat(200) : 'Архивный текст дня'
    await writer.dispatch(writer.state.tr.insertText(content, 1))
    const { createArchiveController } = await server.ssrLoadModule('/src/editor/archiveController.js')
    const archive = createArchiveController(writer.snapshot.record)
    const original = structuredClone(archive.snapshot.record)
    const f = await fixture({ controller: archive, readonlyContent: true })
    try {
      const view = f.ref.current.instance
      const text = view.dom.querySelector('p').firstChild
      const end = text.length - 1
      await act(async () => f.ref.current.selectAll())
      assert.ok(document.querySelector('[role=toolbar]'), 'starting toolbar exists')
      let measures = 0
      const originalCoords = view.coordsAtPos.bind(view)
      view.coordsAtPos = (...args) => { measures++; return originalCoords(...args) }
      const down = pointerEvent('pointerdown')
      await act(async () => view.dom.dispatchEvent(down))
      assert.equal(down.defaultPrevented, false, 'native pointer gesture is not blocked')
      assert.equal(document.querySelector('[role=toolbar]'), null)
      const duringDragMeasures = measures
      await act(async () => {
        const previousSelection = archive.state.selection
        const outside = document.createTextNode('outside day')
        f.container.append(outside)
        window.getSelection().setBaseAndExtent(outside, 0, outside, 3)
        document.dispatchEvent(new dom.window.Event('selectionchange'))
        assert.ok(archive.state.selection.eq(previousSelection), 'intermediate outside range must not force a readonly collapse')
        window.getSelection().setBaseAndExtent(text, 0, text, 3)
        outside.remove()
      })
      for (const boundary of [3, Math.floor(end / 2), end]) {
        await act(async () => {
          window.getSelection().setBaseAndExtent(text, backwards ? end : 0, text, backwards ? end - boundary : boundary)
          document.dispatchEvent(new dom.window.Event('selectionchange'))
          if (long) f.container.querySelector('.writing-scroll').dispatchEvent(new dom.window.Event('scroll'))
          await new Promise(resolve => setTimeout(resolve, 25))
        })
        assert.equal(document.querySelector('[role=toolbar]'), null)
      }
      assert.equal(measures, duringDragMeasures, 'toolbar must not measure transient selection or scroll positions')
      const nativeText = window.getSelection().toString()
      assert.equal(nativeText, content.slice(0, end))
      // Unrelated pointers do not prematurely complete this mouse gesture.
      await act(async () => { document.dispatchEvent(pointerEvent('pointerup', 2)); await new Promise(resolve => setTimeout(resolve, 5)) })
      assert.equal(document.querySelector('[role=toolbar]'), null)
      await act(async () => { document.dispatchEvent(pointerEvent('pointerup')); await new Promise(resolve => setTimeout(resolve, 30)) })
      assert.ok(document.querySelector('[role=toolbar]'))
      assert.equal(window.getSelection().toString(), nativeText)
      assert.equal(archive.state.selection.anchor > archive.state.selection.head, backwards)
      assert.equal(view.dom.getAttribute('contenteditable'), 'false')
      assert.deepEqual(archive.snapshot.record, original, 'selection and scrolling do not save user data')
      for (const label of ['Жирный', 'Курсив', 'Подчёркнутый']) {
        await click(document.querySelector(`[aria-label="${label}"]`))
        await act(async () => archive.flush())
        assert.equal(archive.snapshot.record.content, original.content)
      }
      for (const category of ['Тег', 'Название']) {
        await click(button(category))
        await inputQuery(category)
        await click(button(`Создать «${category}»`))
        await act(async () => archive.flush())
      }
      assert.deepEqual(getSemanticMarkup(archive.state).map(item => item.kind), ['tag', 'title'])
      assert.equal(archive.snapshot.record.content, original.content)
      await act(async () => {
        window.getSelection().removeAllRanges()
        document.dispatchEvent(new dom.window.Event('selectionchange'))
      })
      assert.equal(document.querySelector('[role=toolbar]'), null)
    } finally { await f.close() }
  })
}

test('keyboard selection needs no pointer release; cancel, blur and unmount end pointer lifecycle', async () => {
  const writer = await openWritingController({ profile: { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 } })
  await writer.dispatch(writer.state.tr.insertText('Архивный текст', 1))
  const { createArchiveController } = await server.ssrLoadModule('/src/editor/archiveController.js')
  const archive = createArchiveController(writer.snapshot.record)
  const f = await fixture({ controller: archive, readonlyContent: true })
  try {
    const view = f.ref.current.instance
    await act(async () => {
      view.dom.focus()
      view.dom.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
      // JSDOM has no native arrow navigation: provide its resulting selection.
      const text = view.dom.querySelector('p').firstChild
      window.getSelection().setBaseAndExtent(text, 0, text, 4)
      document.dispatchEvent(new dom.window.Event('selectionchange'))
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    assert.ok(document.querySelector('[role=toolbar]'))
    for (const release of ['pointercancel', 'blur']) {
      await act(async () => view.dom.dispatchEvent(pointerEvent('pointerdown')))
      assert.equal(document.querySelector('[role=toolbar]'), null)
      await act(async () => {
        if (release === 'blur') window.dispatchEvent(new dom.window.Event('blur'))
        else document.dispatchEvent(pointerEvent(release))
        await new Promise(resolve => setTimeout(resolve, 30))
      })
      assert.ok(document.querySelector('[role=toolbar]'))
    }
    await act(async () => {
      view.dom.dispatchEvent(pointerEvent('pointerdown'))
      document.dispatchEvent(pointerEvent('pointerup'))
      await f.render(true, false)
    })
    assert.equal(document.querySelector('[role=toolbar]'), null)
  } finally { await f.close() }
  await act(async () => { document.dispatchEvent(pointerEvent('pointerup')); await new Promise(resolve => setTimeout(resolve, 5)) })
  assert.equal(document.querySelector('[role=toolbar]'), null)
})

test('archive explicit search filters all entities, decorates without writes, preserves navigation state and reveals individual occurrences', async () => {
  const { default: MyTexts } = await server.ssrLoadModule('/src/MyTexts.jsx')
  const { transaction } = await server.ssrLoadModule('/src/storage/database.js')
  const { archiveDocument } = await server.ssrLoadModule('/src/editor/archiveDocument.js')
  const userId = crypto.randomUUID()
  const rows = ['Ёж и ЁЖ', 'Другой день', 'Без совпадений'].map((content, index) => ({
    userId, textId: crypto.randomUUID(), dayKey: ['2026-09-26', '2026-10-03', '2026-10-04'][index], content, revision: 1,
    contentFormat: 'tiptap-json', contentVersion: 1, document: archiveDocument({ content }),
    semanticMarkup: index === 2 ? [] : (index === 0 ? ['title', 'tag'] : ['tag']).map((kind, i) => ({
      id: `${index}-${i}`, valueId: `${index}-${i}`, value: 'ёж', kind, source: 'selection',
      direction: kind === 'title' ? 'forward' : 'backward', anchor: 1, range: { from: 1, to: 3 },
    })),
  }))
  await transaction(['texts'], 'readwrite', tx => rows.forEach(row => tx.objectStore('texts').add(row)))
  const snapshot = () => transaction(['settings', 'texts', 'userDays', 'wordCountSamples'], 'readonly', (tx, done) => {
    const data = {}
    for (const name of ['settings', 'texts', 'userDays', 'wordCountSamples']) {
      const read = tx.objectStore(name).getAll(); read.onsuccess = () => { data[name] = read.result }
    }
    done(data)
  })
  const before = await snapshot()
  const container = document.createElement('div'), sidebar = document.createElement('aside'), navigation = document.createElement('aside')
  document.body.append(container, sidebar, navigation)
  const root = createRoot(container)
  const props = { userId, flush: async () => {}, onTotalWords() {}, metadataHost: sidebar, navigationHost: navigation }
  const settle = async predicate => {
    for (let i = 0; i < 80 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
    assert.ok(predicate(), `search UI should settle: ${navigation.textContent}; ${container.textContent}`)
  }
  const input = () => navigation.querySelector('input')
  const type = async value => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input(), value)
    input().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  const submit = async () => {
    await act(async () => {
      input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      // JSDOM does not synthesize the browser's implicit form submission.
      navigation.querySelector('form').requestSubmit()
    })
    await settle(() => !navigation.querySelector('[aria-label="Найти"]').disabled)
  }
  const summary = () => navigation.querySelector('.archive-search-summary')
  const entries = () => [...container.querySelectorAll('li[data-text-id]')]
  const openCount = () => container.querySelectorAll('.saved-text').length
  const active = () => [...document.querySelectorAll('.archive-search-match.is-current')]
  try {
    await act(async () => root.render(createElement(MyTexts, props)))
    await settle(() => entries().length === 3)
    await click(button('Поиск'))
    assert.equal(button('Названия'), undefined)
    await type('ЕЖ')
    assert.equal(entries().length, 3)
    assert.equal(summary(), null)
    await submit()
    await settle(() => active().length > 0)
    assert.match(summary().textContent, /5 вхождений · 2 текста/)
    assert.deepEqual([...summary().querySelectorAll('dd')].map(node => node.textContent), ['2', '1', '2'])
    assert.equal(openCount(), 2)
    assert.equal(document.querySelectorAll('.archive-search-match').length, 5)
    assert.equal(document.querySelector('[role=toolbar]'), null, 'search does not create user selection')
    assert.equal(navigation.querySelector('[aria-label="Предыдущее вхождение"]').disabled, true)
    const firstId = active()[0].dataset.searchOccurrence
    await type('другой')
    assert.match(summary().textContent, /5 вхождений/)
    assert.equal(entries().length, 2)
    assert.equal(button('‹ Поиск'), undefined)
    assert.equal(button('Поиск'), undefined, 'active heading is not a second return control')
    assert.equal(navigation.querySelector('.menu-item.is-active').textContent, 'Поиск')
    assert.match(container.querySelector('.archive-search-criterion').textContent, /ЕЖ/)
    assert.equal(input().value, 'другой')
    assert.equal(active()[0].dataset.searchOccurrence, firstId)
    await click(navigation.querySelector('[aria-label="Вернуться к навигации Моих текстов"]'))
    assert.deepEqual([...navigation.querySelectorAll('.research-local-children button')].map(node => node.textContent), ['Поиск', 'Названия', 'Теги', 'Публикации'])
    assert.match(container.querySelector('.archive-search-criterion').textContent, /ЕЖ/)
    assert.equal(entries().length, 2)
    await click(button('Поиск'))
    assert.equal(input().value, 'другой')
    assert.equal(active()[0].dataset.searchOccurrence, firstId)
    // Manual collapse is independent of results; navigation reveals only target.
    await click(sidebar.querySelector('.archive-actions button'))
    assert.equal(openCount(), 0)
    assert.match(summary().textContent, /5 вхождений/)
    await click(navigation.querySelector('[aria-label="Следующее вхождение"]'))
    await settle(() => active().length > 0)
    assert.equal(openCount(), 1)
    assert.equal(entries()[1].querySelector('.saved-text'), null)
    for (let i = 0; i < 3; i++) await click(navigation.querySelector('[aria-label="Следующее вхождение"]'))
    await settle(() => active().length > 0 && openCount() === 2)
    assert.equal(navigation.querySelector('[aria-label="Следующее вхождение"]').disabled, true)
    assert.ok(sidebar.querySelector('.semantic-value .is-current'), 'metadata-only record is a navigable result')
    const lastId = active()[0].dataset.searchOccurrence
    await click(navigation.querySelector('[aria-label="Предыдущее вхождение"]'))
    assert.notEqual(active()[0].dataset.searchOccurrence, lastId)
    await click(navigation.querySelector('[aria-label="Следующее вхождение"]'))
    assert.equal(active()[0].dataset.searchOccurrence, lastId)
    await click(entries()[1].querySelector('.archive-record-header'))
    assert.equal(openCount(), 1)
    await click(entries()[1].querySelector('.archive-preview-button'))
    await settle(() => active().some(node => node.dataset.searchOccurrence === lastId))
    // Period changes retain executed query, not edited draft, and full markers.
    await click(container.querySelector('[aria-controls="archive-calendar"]'))
    const september = [...container.querySelectorAll('[aria-label="Месяцы"] button')].find(node => node.textContent === 'Сентябрь')
    await click(september)
    await settle(() => entries().length === 1)
    assert.match(summary().textContent, /4 вхождения · 1 текст/)
    assert.equal(input().value, 'другой')
    const october = [...container.querySelectorAll('[aria-label="Месяцы"] button')].find(node => node.textContent === 'Октябрь')
    assert.ok(october.querySelector('.research-month-mark'), 'calendar data is not filtered by search')
    await click(container.querySelector('[aria-label="Снять выбранный период"]'))
    await settle(() => entries().length === 2)
    // Existing selection/panel must go away when the next result excludes it.
    await click(sidebar.querySelector(`[data-archive-date="${rows[0].textId}"]`))
    assert.ok(document.querySelector('[role=toolbar]'))
    await type('нет такого запроса')
    await submit()
    assert.equal(entries().length, 0)
    assert.match(summary().textContent, /0 вхождений · 0 текстов/)
    assert.equal(active().length, 0)
    assert.equal(document.querySelector('[role=toolbar]'), null)
    assert.ok(window.getSelection().isCollapsed)
    assert.equal(navigation.querySelector('.archive-search-paging'), null)
    await type('ЕЖ')
    await click(navigation.querySelector('[aria-label="Найти"]'))
    await settle(() => entries().length === 2)
    await click(container.querySelector('[aria-label="Снять поиск"]'))
    await settle(() => entries().length === 3)
    assert.equal(document.querySelector('.archive-search-match'), null)
    await type('ЕЖ'); await submit()
    await type(''); await submit()
    assert.equal(entries().length, 3)
    assert.equal(container.querySelector('.archive-search-criterion'), null)
    await type('ЕЖ'); await submit()
    await act(async () => root.render(null))
    await act(async () => root.render(createElement(MyTexts, props)))
    await settle(() => entries().length === 3)
    assert.equal(navigation.querySelector('input'), null)
    assert.equal(container.querySelector('.archive-search-criterion'), null)
    assert.deepEqual(await snapshot(), before, 'search, highlights, navigation and collapse never write any store')
  } finally { await act(async () => root.unmount()); container.remove(); sidebar.remove(); navigation.remove() }
})

test('search decorations coexist with readonly B/I/U, Undo/redo and semantic actions without becoming saved marks', async () => {
  const writer = await openWritingController({ profile: { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 } })
  await writer.dispatch(writer.state.tr.insertText('Ёж и ёж', 1))
  const { createArchiveController } = await server.ssrLoadModule('/src/editor/archiveController.js')
  const { archiveSearch } = await server.ssrLoadModule('/src/domain/archiveSearch.js')
  const archive = createArchiveController(writer.snapshot.record)
  const occurrences = archiveSearch([writer.snapshot.record], 'еж').occurrences
  const f = await fixture({ controller: archive, readonlyContent: true, searchOccurrences: occurrences, activeSearchId: occurrences[0].id })
  try {
    assert.equal(f.container.querySelectorAll('.archive-search-match').length, 2)
    assert.equal(f.container.querySelectorAll('.archive-search-match.is-current').length, 1)
    await act(async () => f.ref.current.selectAll())
    for (const label of ['Жирный', 'Курсив', 'Подчёркнутый']) {
      await click(document.querySelector(`[aria-label="${label}"]`))
      await act(async () => archive.flush())
    }
    assert.equal(f.container.querySelectorAll('.archive-search-match').length, 2)
    assert.equal(archive.snapshot.record.content, 'Ёж и ёж')
    for (const node of archive.snapshot.record.document.content[0].content) {
      if (node.type === 'text') assert.deepEqual(node.marks.map(mark => mark.type).sort(), ['bold', 'italic', 'underline'])
    }
    await act(async () => { undo(archive.state, tr => archive.dispatch(tr)); await archive.flush() })
    await act(async () => { redo(archive.state, tr => archive.dispatch(tr)); await archive.flush() })
    assert.equal(f.container.querySelectorAll('.archive-search-match').length, 2)
    await click(button('Тег')); await inputQuery('ёж'); await click(button('Создать «ёж»'))
    await act(async () => archive.flush())
    assert.equal(getSemanticMarkup(archive.state)[0].value, 'ёж')
    assert.ok(!JSON.stringify(archive.snapshot.record).includes('archive-search'), 'presentation attributes never enter persisted data')
    assert.equal(f.ref.current.instance.dom.getAttribute('contenteditable'), 'false')
  } finally { await f.close() }
})

for (const backward of [false, true]) {
  test(`archive selection toolbar sticks to viewport and returns above selection (${backward ? 'backward' : 'forward'})`, async () => {
    const writer = await openWritingController({ profile: { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 } })
    await writer.dispatch(writer.state.tr.insertText('Длинный архивный текст', 1))
    const { createArchiveController } = await server.ssrLoadModule('/src/editor/archiveController.js')
    const archive = createArchiveController(writer.snapshot.record)
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => ({ ...rect, top: 100, bottom: 700, height: 600 })
    const f = await fixture({ controller: archive, readonlyContent: true, scrollElement: scroller })
    try {
      const view = f.ref.current.instance
      let firstTop = 200
      view.coordsAtPos = () => ({ ...rect, top: firstTop, bottom: firstTop + 31 })
      await act(async () => f.ref.current.selectAll())
      await act(async () => {
        await archive.dispatch(archive.state.tr.setSelection(TextSelection.create(archive.state.doc, backward ? 20 : 2, backward ? 2 : 20)), 'selection')
      })
      const toolbar = document.querySelector('[role=toolbar]')
      assert.ok(toolbar)
      toolbar.getBoundingClientRect = () => ({ ...rect, height: 40 })
      await act(async () => window.dispatchEvent(new dom.window.Event('resize')))
      assert.equal(toolbar.style.top, '160px')
      firstTop = -200
      await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll')))
      assert.equal(toolbar.style.top, '108px')
      const savedRects = dom.window.Range.prototype.getClientRects
      try {
        dom.window.Range.prototype.getClientRects = () => [{ ...rect, top: -200, bottom: -180 }, { ...rect, top: 180, bottom: 200 }]
        await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll')))
        assert.equal(toolbar.style.top, '108px', 'toolbar stays directly below the current text viewport, above the visible line')
      } finally { dom.window.Range.prototype.getClientRects = savedRects }
      await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll')))
      await click(document.querySelector('[aria-label="Жирный"]'))
      await act(async () => archive.flush())
      assert.equal(archive.snapshot.record.content, writer.snapshot.record.content)
      assert.ok(archive.state.doc.rangeHasMark(2, 20, archive.state.schema.marks.bold))
      assert.equal(document.querySelector('[role=toolbar]').style.top, '108px')
      firstTop = 240
      await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll')))
      assert.equal(document.querySelector('[role=toolbar]').style.top, '200px')
      await act(async () => {
        window.getSelection().removeAllRanges()
        document.dispatchEvent(new dom.window.Event('selectionchange'))
      })
      assert.equal(document.querySelector('[role=toolbar]'), null)
      assert.equal(view.dom.getAttribute('contenteditable'), 'false')
    } finally { await f.close() }
  })
}


test('quick current-day search highlights literal text/title/tag matches, wraps both ways, keeps caret/focus and clears on toggle/Esc without storage writes', async () => {
  const { transaction } = await server.ssrLoadModule('/src/storage/database.js')
  const controller = await openWritingController({ profile: { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 } })
  await controller.dispatch(controller.state.tr.insertText('Ёж один ёж. Фраза два.'))
  for (const [id, kind, value, from, to] of [['title', 'title', 'ЁЖ название', 1, 3], ['tag', 'tag', 'ТОП ёж', 4, 8]]) {
    await controller.dispatch(controller.state.tr.setSelection(TextSelection.create(controller.state.doc, from, to)))
    await controller.dispatch(assignSelectionMarkup(controller.state, { id, kind, value, valueId: id }))
  }
  await controller.flush()
  const stores = ['settings', 'texts', 'userDays', 'wordCountSamples', 'publications', 'publicationAnchors']
  const snapshot = () => transaction(stores, 'readonly', (tx, done) => {
    const values = {}; done(values)
    for (const name of stores) { const read = tx.objectStore(name).getAll(); read.onsuccess = () => { values[name] = read.result } }
  })
  const before = await snapshot(), docBefore = controller.state.doc.toJSON(), selectionBefore = controller.state.selection
  const markupBefore = getSemanticMarkup(controller.state)
  const container = document.createElement('div'), sidebar = document.createElement('aside'), icon = document.createElement('button')
  document.body.append(container, sidebar, icon)
  const ref = createRef(), anchor = { current: icon }, root = createRoot(container)
  const render = open => root.render(createElement(WritingEditor, { ref, controller, writing: true, active: true, ready: true, metadataHost: sidebar,
    quickSearchOpen: open, searchAnchor: anchor, onSearchClose: () => render(false), onActivate() {} }))
  const settle = async predicate => {
    for (let i = 0; i < 80 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
    assert.ok(predicate(), `search should settle: ${document.querySelector('.day-search')?.textContent}`)
  }
  const input = () => document.querySelector('[aria-label="Найти в текущем дне"]')
  const query = async value => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input(), value)
      input().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
  }
  const active = () => [...container.querySelectorAll('.archive-search-match.is-current'), ...sidebar.querySelectorAll('.archive-search-match.is-current')]
  const move = direction => click(document.querySelector(`[aria-label="${direction > 0 ? 'Следующее' : 'Предыдущее'} совпадение"]`))
  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this === sidebar) return { ...rect, left: 800, right: 1000, width: 200, top: 100, bottom: 400, height: 300 }
    if (this.classList.contains('day-search')) return { ...rect, top: 58, bottom: 150, height: 92 }
    if (this === icon) return { ...rect, top: 20, bottom: 48 }
    if (this.classList.contains('writing-scroll')) return { ...rect, top: 100, bottom: 400, height: 300 }
    if (this.classList.contains('archive-search-match')) {
      const scroller = container.querySelector('.writing-scroll')
      const top = (sidebar.contains(this) ? 600 : 200) - scroller.scrollTop
      return { ...rect, top, bottom: top + 20 }
    }
    return originalRect.call(this)
  }
  try {
    await act(async () => render(true))
    await settle(() => input() && document.activeElement === input())
    const panel = document.querySelector('.day-search'), scroller = container.querySelector('.writing-scroll')
    assert.equal(container.contains(panel), false, 'search controls stay outside the text layout')
    assert.equal(panel.style.width, '130px')
    assert.equal(panel.style.left, '835px')
    assert.equal(panel.style.top, '58px')
    assert.ok([...sidebar.querySelectorAll('.semantic-group')].every(group => parseFloat(group.style.top) >= 58), 'semantic labels remain visible below the search controls')
    const view = ref.current.instance, originalCoords = view.coordsAtPos
    view.coordsAtPos = position => ({ ...rect, top: position === 1 ? -100 : 180 })
    await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll')))
    assert.ok(parseFloat(sidebar.querySelector('.semantic-group').style.top) < 0, 'offscreen labels do not accumulate below search controls')
    view.coordsAtPos = originalCoords
    await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll')))
    await query('ФРАЗА два')
    assert.equal(container.querySelectorAll('.archive-search-match').length, 1)
    assert.equal(sidebar.querySelector('.archive-search-match'), null)
    assert.equal(active()[0].textContent, 'Фраза два')
    assert.ok(panel.textContent.includes('1 / 1'))
    scroller.scrollTop = 300
    await move(1); assert.ok(panel.textContent.includes('1 / 1'))
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)))
    assert.ok(scroller.scrollTop < 300, 'navigation reveals even the only occurrence after manual scrolling')
    await query('название')
    assert.equal(container.querySelector('.archive-search-match'), null)
    assert.equal(active()[0].closest('.semantic-value').dataset.kind, 'title')
    assert.ok(scroller.scrollTop > 0, 'out-of-view semantic label is brought into view')
    await query('ТОП')
    assert.equal(container.querySelector('.archive-search-match'), null, 'tag match does not decorate its associated text')
    assert.equal(active()[0].closest('.semantic-value').dataset.kind, 'tag')
    await query('ЕЖ')
    assert.equal(container.querySelectorAll('.archive-search-match').length, 2)
    assert.equal(sidebar.querySelectorAll('.archive-search-match').length, 2)
    assert.equal(active().length, 1)
    assert.ok(panel.textContent.includes('1 / 4'))
    const first = active()[0].dataset.searchOccurrence
    await move(-1); assert.ok(panel.textContent.includes('4 / 4'))
    assert.equal(active().length, 1)
    await move(1); assert.equal(active()[0].dataset.searchOccurrence, first)
    const visited = new Set([first])
    for (let i = 0; i < 3; i++) { await move(1); visited.add(active()[0].dataset.searchOccurrence) }
    assert.equal(visited.size, 4)
    await move(1); assert.equal(active()[0].dataset.searchOccurrence, first)
    assert.equal(document.activeElement, input())
    assert.equal(ref.current.instance.hasFocus(), false)
    assert.ok(controller.state.selection.eq(selectionBefore), 'search navigation never moves editor selection')
    await query('невозможное совпадение')
    assert.equal(panel.querySelector('.archive-search-paging span').textContent, '0')
    assert.ok([...panel.querySelectorAll('button')].every(button => button.disabled))
    assert.equal(panel.querySelector('[role=alert]'), null)
    await query('еж')
    await act(async () => render(false))
    assert.equal(document.querySelector('.day-search'), null)
    assert.equal(container.querySelector('.archive-search-match'), null)
    assert.equal(sidebar.querySelector('.archive-search-match'), null)
    await act(async () => render(true))
    await settle(() => input() && document.activeElement === input())
    assert.equal(input().value, '')
    await query('еж')
    await act(async () => input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    assert.equal(document.querySelector('.day-search'), null)
    assert.equal(container.querySelector('.archive-search-match'), null)
    assert.equal(sidebar.querySelector('.archive-search-match'), null)
    assert.deepEqual(controller.state.doc.toJSON(), docBefore)
    assert.deepEqual(getSemanticMarkup(controller.state), markupBefore)
    assert.deepEqual(await snapshot(), before)
  } finally {
    dom.window.HTMLElement.prototype.getBoundingClientRect = originalRect
    await act(async () => root.unmount()); container.remove(); sidebar.remove(); icon.remove()
  }
})
