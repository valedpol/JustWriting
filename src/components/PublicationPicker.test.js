import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement, createRef } from 'react'
import { TextSelection } from '@tiptap/pm/state'

const factory = new IDBFactory(), databaseName = `jw-publication-ui-${crypto.randomUUID()}`
globalThis.indexedDB = { open: (_name, version) => factory.open(databaseName, version) }
globalThis.IDBKeyRange = IDBKeyRange
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'DOMParser', 'MutationObserver', 'getComputedStyle']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
document.elementFromPoint = () => null
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
const rect = { top: 100, bottom: 120, left: 300, right: 310, width: 10, height: 20 }
dom.window.Range.prototype.getBoundingClientRect = () => rect
dom.window.Range.prototype.getClientRects = () => [rect]
dom.window.HTMLElement.prototype.getBoundingClientRect = () => rect
dom.window.HTMLElement.prototype.getClientRects = () => [rect]
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const { default: WritingEditor } = await server.ssrLoadModule('/src/components/WritingEditor.jsx')
const { default: ArchiveWritingEntry } = await server.ssrLoadModule('/src/components/ArchiveWritingEntry.jsx')
const { createArchiveController } = await server.ssrLoadModule('/src/editor/archiveController.js')
const { transaction, openDatabase } = await server.ssrLoadModule('/src/storage/database.js')
const { createPublications } = await server.ssrLoadModule('/src/storage/publicationRepository.js')
const { maintenance } = await server.ssrLoadModule('/src/runtime/maintenance.js')
after(async () => { (await openDatabase()).close(); await server.close(); dom.window.close() })
const all = () => transaction(['settings', 'texts', 'userDays', 'wordCountSamples', 'publications'], 'readonly', (tx, done) => {
  const result = {}; done(result)
  for (const name of tx.objectStoreNames) { const read = tx.objectStore(name).getAll(); read.onsuccess = () => { result[name] = read.result } }
})
const label = (id, value, range, kind = 'title') => ({ id, valueId: id, kind, value, range, source: range ? 'selection' : 'slash', direction: kind === 'title' ? 'forward' : 'backward', anchor: range?.from ?? 1 })
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
  assert.ok(predicate(), 'publication UI should settle')
}
async function click(element) {
  assert.ok(element, 'control exists')
  await act(async () => {
    const down = new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
    element.dispatchEvent(down)
    if (!down.defaultPrevented) element.focus()
    element.click()
    await new Promise(resolve => setTimeout(resolve, 5))
  })
}
const picker = () => document.querySelector('[aria-label="Каналы публикации"]')
const publishButton = () => [...document.querySelectorAll('.editor-panel-row button')].find(button => button.textContent === 'Опубликовать')
async function fixture(markup = []) {
  const userId = crypto.randomUUID(), textId = crypto.randomUUID(), userDayId = crypto.randomUUID()
  const record = { textId, userId, userDayId, dayKey: '2026-10-07', revision: 3, content: 'alpha beta gamma',
    contentFormat: 'tiptap-json', contentVersion: 1, document: { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'alpha beta gamma', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }] },
    ] }] }, semanticMarkup: markup, extra: { missing: undefined, nil: null, bytes: new Uint8Array([4, 5]) } }
  await transaction(['settings', 'texts', 'userDays', 'wordCountSamples'], 'readwrite', tx => {
    tx.objectStore('settings').put({ key: 'localProfile', userId, displayName: 'Author', createdAt: 1 })
    tx.objectStore('texts').add(record)
    tx.objectStore('userDays').add({ userDayId, userId, dayKey: record.dayKey, startsAt: 0, endsAt: 1, revision: 1, state: 'closed' })
    tx.objectStore('wordCountSamples').add({ sampleId: crypto.randomUUID(), userDayId, timestamp: 1, wordCount: 3 })
  })
  const controller = createArchiveController(record)
  const off = maintenance.registerFlush(() => controller.flush())
  const container = document.createElement('div'), sidebar = document.createElement('aside'); document.body.append(container, sidebar)
  const root = createRoot(container), ref = createRef()
  const render = async (entry = false) => act(async () => root.render(entry
    ? createElement(ArchiveWritingEntry, { record, metadataHost: sidebar })
    : createElement(WritingEditor, { ref, controller, readonlyContent: true, active: true, writing: true, ready: true, metadataHost: sidebar })))
  await render()
  await act(async () => { await all() })
  const select = async (range) => {
    await act(async () => {
      if (range) {
        const view = ref.current.instance
        view.dom.focus()
        await controller.dispatch(controller.state.tr.setSelection(TextSelection.create(controller.state.doc, range.from, range.to)))
        const start = view.domAtPos(range.from), end = view.domAtPos(range.to)
        window.getSelection().setBaseAndExtent(start.node, start.offset, end.node, end.offset)
        document.dispatchEvent(new dom.window.Event('selectionchange'))
      }
      else ref.current.selectAll()
    })
    await settle(() => !!publishButton())
  }
  const showPicker = async (range) => { await select(range); await click(publishButton()); await settle(() => picker() && !picker().querySelector('input').disabled) }
  const confirm = async channels => {
    for (const channel of channels) await click(picker().querySelectorAll('input')[['profile', 'feed', 'internet'].indexOf(channel)])
    await click([...picker().querySelectorAll('button')].find(button => button.textContent === 'Опубликовать'))
  }
  return { record, controller, container, sidebar, root, render, select, showPicker, confirm,
    async close() { await act(async () => root.unmount()); off(); container.remove(); sidebar.remove(); window.getSelection().removeAllRanges() } }
}

for (const channels of [['profile'], ['feed'], ['internet'], ['profile', 'feed', 'internet']]) {
  test(`archive UI publishes ${channels.join('+')}, preserves source stores and displays derived markers after remount`, async () => {
    const f = await fixture([label('private-tag', 'Secret', { from: 1, to: 5 }, 'tag')])
    try {
      const before = await all()
      await f.showPicker()
      assert.equal(picker().querySelectorAll('input').length, 3)
      assert.equal(picker().querySelector('button').disabled, true)
      assert.equal(f.container.querySelector('.ProseMirror').getAttribute('contenteditable'), 'false')
      const editor = f.container.querySelector('.ProseMirror'), selection = f.controller.state.selection
      await f.confirm(channels)
      await settle(() => !picker() && f.sidebar.querySelectorAll('.publication-marker').length === channels.length)
      assert.equal(f.container.querySelector('.ProseMirror'), editor, 'source editor is not recreated')
      assert.ok(f.controller.state.selection.eq(selection), 'source selection remains unchanged')
      const after = await all(), added = after.publications.filter(p => p.userId === f.record.userId)
      assert.equal(added.length, channels.length)
      assert.deepEqual(added.map(p => p.channel).sort(), [...channels].sort())
      for (const name of ['settings', 'texts', 'userDays', 'wordCountSamples']) assert.deepEqual(after[name], before[name])
      for (const p of added) {
        assert.equal(p.snapshot.content, f.record.content)
        assert.equal(p.snapshot.document.content[0].content[0].marks.length, 3)
        assert.equal('semanticMarkup' in p.snapshot, false)
        assert.equal('authorVisibility' in p, p.channel !== 'profile')
        if (p.channel !== 'profile') assert.equal(p.authorVisibility, 'visible')
      }
      const labels = { profile: '↗ В профиле', feed: '↗ В ленте', internet: '↗ В интернете' }
      assert.deepEqual([...f.sidebar.querySelectorAll('.publication-marker')].map(el => el.textContent).sort(), channels.map(c => labels[c]).sort())
      assert.equal(f.sidebar.querySelector('.publication-marker button'), null)
      await act(async () => f.root.render(null))
      await f.render(true)
      await settle(() => f.sidebar.querySelectorAll('.publication-marker').length === channels.length)
    } finally { await f.close() }
  })
}

test('cancel picker makes no writes; exact existing channel is disabled while other channels, overlaps and nesting remain available', async () => {
  const f = await fixture()
  try {
    const before = await all()
    await f.showPicker(); await click([...picker().querySelectorAll('button')].find(b => b.textContent === 'Отмена'))
    assert.deepEqual(await all(), before)
    await f.showPicker(); await f.confirm(['profile']); await settle(() => !picker())
    await f.select(); await click(publishButton())
    await settle(() => picker()?.querySelector('input').checked)
    assert.equal(picker().querySelector('input').disabled, true)
    assert.ok(picker().textContent.includes('В профиле'))
    assert.equal(picker().querySelectorAll('input')[1].disabled, false)
    await f.confirm(['feed']); await settle(() => !picker())
    for (const range of [{ from: 2, to: 8 }, { from: 3, to: 5 }]) {
      await f.showPicker(range); assert.equal(picker().querySelector('input').disabled, false)
      await f.confirm(['profile']); await settle(() => !picker())
    }
    assert.equal((await all()).publications.filter(p => p.userId === f.record.userId).length, 4)
  } finally { await f.close() }
})

for (const [name, markup, range, expected] of [
  ['exact', [label('title-a', 'Name', { from: 1, to: 17 })], undefined, 'Name'],
  ['wider', [label('title-b', 'Name', { from: 2, to: 8 })], undefined, undefined],
  ['narrower', [label('title-c', 'Name', { from: 1, to: 17 })], { from: 2, to: 8 }, undefined],
  ['unresolved', [label('title-d', 'Name', null)], undefined, undefined],
  ['ambiguous', [label('title-e', 'One', { from: 1, to: 17 }), label('title-f', 'Two', { from: 1, to: 17 })], undefined, undefined],
]) {
  test(`UI delegates ${name} title inheritance to source adapter`, async () => {
    const f = await fixture(markup)
    try {
      await f.showPicker(range); await f.confirm(['profile']); await settle(() => !picker())
      const [publication] = (await all()).publications.filter(p => p.userId === f.record.userId)
      assert.equal(publication.snapshot.title, expected)
    } finally { await f.close() }
  })
}

test('stale revision after opening picker stops creation and reports a compact error without touching source', async () => {
  const f = await fixture()
  try {
    await f.showPicker()
    await transaction(['texts'], 'readwrite', tx => tx.objectStore('texts').put({ ...f.record, revision: 4 }))
    const before = await all()
    await f.confirm(['profile', 'feed'])
    await settle(() => !!picker()?.querySelector('[role="alert"]'))
    assert.deepEqual(await all(), before)
    assert.ok(picker().textContent.includes('выделите фрагмент заново'))
  } finally { await f.close() }
})

test('duplicate race aborts all UI-selected channels; no partial add or source mutation', async () => {
  const f = await fixture()
  try {
    await f.showPicker()
    await act(async () => createPublications(f.record.userId, { source: { sourceType: 'archive', sourceId: f.record.textId, sourceRevision: 3, coordinateVersion: 1,
      range: { from: 1, to: 17 }, archive: { userDayId: f.record.userDayId, dayKey: f.record.dayKey } }, channels: ['feed'] }))
    const before = await all()
    await f.confirm(['profile', 'feed'])
    await settle(() => !!picker()?.querySelector('[role="alert"]'))
    assert.deepEqual(await all(), before)
    assert.ok(picker().textContent.includes('уже опубликован'))
  } finally { await f.close() }
})

test('publication action needs a nonempty archive selection; deselection hides tools; pointer drag keeps tools hidden', async () => {
  const f = await fixture()
  try {
    assert.equal(publishButton(), undefined)
    await f.select({ from: 1, to: 6 })
    const view = f.container.querySelector('.ProseMirror')
    await act(async () => view.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, button: 0 })))
    assert.equal(publishButton(), undefined)
    await act(async () => { document.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, button: 0 })); await new Promise(resolve => setTimeout(resolve, 30)) })
    await settle(() => !!publishButton())
    await act(async () => {
      window.getSelection().removeAllRanges()
      document.dispatchEvent(new dom.window.Event('selectionchange'))
    })
    assert.equal(publishButton(), undefined)
    assert.equal(picker(), null)
  } finally { await f.close() }
})

test('failed live flush cannot publish or mutate source, even with all channels selected', async () => {
  const f = await fixture()
  const off = maintenance.registerFlush(async () => { throw new Error('unsaved source') })
  try {
    await f.showPicker()
    const before = await all()
    await f.confirm(['profile', 'feed', 'internet'])
    await settle(() => !!picker()?.querySelector('[role="alert"]'))
    assert.deepEqual(await all(), before)
  } finally { off(); await f.close() }
})

test('picker blocks repeat submission and channel changes while source flush is pending', async () => {
  const f = await fixture()
  let release
  const off = maintenance.registerFlush(() => new Promise(resolve => { release = resolve }))
  try {
    await f.showPicker()
    const before = await all()
    await f.confirm(['profile'])
    await settle(() => picker()?.getAttribute('aria-busy') === 'true' && !!release)
    for (const control of picker().querySelectorAll('input, button')) assert.equal(control.disabled, true)
    assert.deepEqual(await all(), before)
    await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 10)) })
    await settle(() => !picker())
    assert.equal((await all()).publications.filter(p => p.userId === f.record.userId).length, 1)
  } finally { release?.(); off(); await f.close() }
})

test('collapsed publication summary derives from the store across collapse/reload and disappears when no publication remains', async () => {
  const f = await fixture()
  const { default: MyTexts } = await server.ssrLoadModule('/src/MyTexts.jsx')
  const { deletePublication } = await server.ssrLoadModule('/src/storage/publicationRepository.js')
  try {
    await f.showPicker(); await f.confirm(['profile', 'feed', 'internet']); await settle(() => !picker())
    const before = await all()
    const renderArchive = async () => {
      await act(async () => f.root.render(null))
      await act(async () => f.root.render(createElement(MyTexts, { userId: f.record.userId, flush: () => f.controller.flush(), onTotalWords() {}, metadataHost: f.sidebar })))
      await settle(() => !!f.container.querySelector('.archive-preview-button'))
      await act(async () => { await all() })
    }
    await renderArchive()
    await settle(() => f.sidebar.querySelectorAll('.archive-publication-summary').length === 1)
    assert.equal(f.sidebar.querySelector('.archive-publication-summary').textContent, '↗ Публикация')
    await click(f.container.querySelector('.archive-preview-button'))
    await settle(() => f.sidebar.querySelectorAll('.publication-marker').length === 3)
    assert.equal(f.sidebar.querySelector('.archive-publication-summary'), null)
    assert.equal(f.sidebar.querySelector('.archive-collapse-strip'), null)
    await click(f.sidebar.querySelector('.publication-marker'))
    assert.ok(f.container.querySelector('.ProseMirror'), 'rail marker does not collapse source')
    await click(f.sidebar.querySelector('.archive-day-metadata'))
    assert.ok(f.container.querySelector('.ProseMirror'), 'blank right column does not collapse source')
    await click(f.container.querySelector('.archive-record-header'))
    await settle(() => !!f.sidebar.querySelector('.archive-publication-summary'))
    await renderArchive()
    await settle(() => !!f.sidebar.querySelector('.archive-publication-summary'))
    const records = before.publications.filter(p => p.userId === f.record.userId)
    await act(async () => deletePublication(f.record.userId, records[0].publicationId))
    await renderArchive()
    await settle(() => !!f.sidebar.querySelector('.archive-publication-summary'))
    for (const record of records.slice(1)) await act(async () => deletePublication(f.record.userId, record.publicationId))
    await renderArchive()
    assert.equal(f.sidebar.querySelector('.archive-publication-summary'), null)
    const after = await all()
    for (const name of ['settings', 'texts', 'userDays', 'wordCountSamples']) assert.deepEqual(after[name], before[name])
  } finally { await f.close() }
})

test('archive calendar readonly repository loads saved userDays for the owner without advancing or rewriting days', async () => {
  const f = await fixture()
  const { listUserDays } = await server.ssrLoadModule('/src/storage/dayRepository.js')
  try {
    await transaction(['userDays'], 'readwrite', tx => {
      const read = tx.objectStore('userDays').get(f.record.userDayId)
      read.onsuccess = () => tx.objectStore('userDays').put({ ...read.result, dailyWordGoal: 100, goalReached: true })
    })
    const before = await all()
    const days = await listUserDays(f.record.userId)
    assert.equal(days.length, 1)
    assert.equal(days[0].goalReached, true)
    assert.equal(days[0].dailyWordGoal, 100)
    assert.equal(days[0].state, 'closed')
    assert.deepEqual(await all(), before)
  } finally { await f.close() }
})
