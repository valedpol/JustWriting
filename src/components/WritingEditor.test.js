import 'fake-indexeddb/auto'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement, createRef } from 'react'

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
const { TextSelection } = await import('@tiptap/pm/state')
const { undo, redo } = await import('@tiptap/pm/history')
after(async () => { await server.close(); dom.window.close() })

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
    root.render(createElement(WritingEditor, { ref, controller, writing, active, ready: true, metadataHost: sidebar, onActivate() {}, readonlyContent: options.readonlyContent ?? false }))
  })
  await render()
  return { controller, container, sidebar, ref, render, async close() { await act(async () => root.unmount()); container.remove(); sidebar.remove() } }
}

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
    await click(sidebar.querySelector('.archive-collapse-strip'))
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
    assert.deepEqual([...document.querySelectorAll('.editor-panel-row button')].map(node => node.textContent), ['B', 'I', 'U', 'Тег', 'Название'])
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
  await act(async () => {
    view.dom.dispatchEvent(new dom.window.CompositionEvent('compositionend', { bubbles: true, data: '你' }))
    view.dom.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertFromComposition', data: '你' }))
    await new Promise(resolve => setTimeout(resolve, 60))
    await f.controller.flush()
  })
  assert.equal(f.controller.snapshot.text, '你')
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
    const editor = container.querySelector('.ProseMirror')
    assert.equal(editor.getAttribute('contenteditable'), 'false')
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
    await click(container.querySelector('button[aria-label="Перейти в широкий режим"]'))
    await settle(() => container.querySelector('.screen-writing-wide'))
    assert.equal(container.querySelector('.ProseMirror'), editor)
    await click(container.querySelector('button[aria-label="Перейти в стандартный режим"]'))
    assert.equal(container.querySelector('.ProseMirror'), editor)
    await click(button('Мои тексты'))
    await settle(() => container.querySelector('.text-preview'))
    assert.equal(container.querySelector('.today-editor-shell').hidden, true)
    await click(container.querySelector('.text-preview').closest('button'))
    await settle(() => container.querySelector('.saved-text strong'))
    assert.equal(container.querySelector('.saved-text strong').textContent, 'А')
    assert.equal(container.querySelector('.saved-text [contenteditable=true]'), null)
    assert.ok(container.querySelector('.saved-text [contenteditable=false]'))
    await click(button('Текст сегодня'))
    assert.equal(container.querySelector('.ProseMirror'), editor)
    assert.equal(editor.getAttribute('contenteditable'), 'false')
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
