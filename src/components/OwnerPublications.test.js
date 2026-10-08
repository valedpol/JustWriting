import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

const factory = new IDBFactory(), name = `jw-owner-ui-${crypto.randomUUID()}`
globalThis.indexedDB = { open: (_name, version) => factory.open(name, version) }
globalThis.IDBKeyRange = IDBKeyRange
const dom = new JSDOM('<body></body>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'DOMParser', 'MutationObserver', 'getComputedStyle']) globalThis[key] = dom.window[key]
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true })
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
// Opening an archive editor measures semantic anchors through browser Ranges.
const rangeRect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
dom.window.Range.prototype.getBoundingClientRect = () => rangeRect
dom.window.Range.prototype.getClientRects = () => [rangeRect]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const style = document.createElement('style')
style.textContent = ['../App.css', '../MyTexts.css', './OwnerPublications.css'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
document.head.append(style)
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error',
  plugins: [{ name: 'owner-footer-today-fixture', enforce: 'pre', transform(_code, id) {
    if (id.endsWith('/src/hooks/useTodayText.js')) return 'export const useTodayText = () => globalThis.__ownerTodayFixture'
  } }] })
const { default: MyTexts } = await server.ssrLoadModule('/src/MyTexts.jsx')
const { default: OwnerPublications } = await server.ssrLoadModule('/src/components/OwnerPublications.jsx')
const { transaction, openDatabase } = await server.ssrLoadModule('/src/storage/database.js')
const { createPublicationRepository, deletePublication } = await server.ssrLoadModule('/src/storage/publicationRepository.js')
after(async () => { delete globalThis.__ownerTodayFixture; (await openDatabase()).close(); await server.close(); dom.window.close() })
const stores = ['settings', 'texts', 'userDays', 'wordCountSamples', 'publications']
const all = () => transaction(stores, 'readonly', (tx, done) => {
  const result = {}; done(result)
  for (const store of stores) { const read = tx.objectStore(store).getAll(); read.onsuccess = () => { result[store] = read.result } }
})
const sourceStores = data => stores.slice(0, 4).map(store => data[store])
const button = (container, text) => [...(container.closest('.editor-column')?.parentElement ?? container).querySelectorAll('button')].find(node => (node.querySelector('.owner-publication-channel-label')?.textContent ?? node.textContent) === text)
async function click(node) { assert.ok(node); await act(async () => { node.click(); await new Promise(resolve => setTimeout(resolve, 5)) }) }
async function settle(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
  assert.ok(predicate())
}
async function fixture() {
  const userId = crypto.randomUUID(), others = [crypto.randomUUID(), crypto.randomUUID()]
  const text = { textId: crypto.randomUUID(), userDayId: crypto.randomUUID(), userId, dayKey: '2026-10-07', revision: 3,
    content: 'alpha beta gamma', contentFormat: 'tiptap-json', contentVersion: 1,
    document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alpha beta gamma', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }] }] }] },
    semanticMarkup: [{ id: 'title', valueId: 'title', kind: 'title', value: 'Saved title', source: 'selection', direction: 'forward', anchor: 1, range: { from: 1, to: 17 } },
      { id: 'tag', valueId: 'tag', kind: 'tag', value: 'PRIVATE TAG', source: 'selection', direction: 'backward', anchor: 1, range: { from: 1, to: 6 } }] }
  await transaction(['texts', 'userDays', 'settings'], 'readwrite', tx => {
    tx.objectStore('texts').add(text)
    tx.objectStore('userDays').add({ userDayId: text.userDayId, userId, dayKey: text.dayKey, revision: 1 })
    tx.objectStore('settings').put({ key: 'localProfile', userId, displayName: 'PRIVATE OWNER' })
    tx.objectStore('settings').put({ key: `publicProfile:${userId}`, userId, authorVisibility: 'hidden' })
  })
  let timestamp = 100, nextId = 0
  const repo = createPublicationRepository({ flush: async () => {}, now: () => timestamp, id: () => `${userId}-${++nextId}` })
  const source = { sourceType: 'archive', sourceId: text.textId, sourceRevision: 3, coordinateVersion: 1, range: { from: 0, to: 18 }, archive: { userDayId: text.userDayId, dayKey: text.dayKey } }
  const records = await repo.createPublications(userId, { source, channels: ['profile', 'feed', 'internet'] })
  timestamp = 200
  const [newer] = await repo.createPublications(userId, { source: { ...source, range: { from: 1, to: 6 } }, channels: ['feed'] })
  const [tied] = await repo.createPublications(userId, { source: { ...source, range: { from: 6, to: 11 } }, channels: ['feed'] })
  await transaction(['publications'], 'readwrite', tx => others.forEach((owner, i) => tx.objectStore('publications').add({ ...records[1], userId: owner, publicationId: `${owner}-${i}`, snapshot: { ...records[1].snapshot, content: 'FOREIGN CONTENT', document: undefined } })))
  const shell = document.createElement('div'), main = document.createElement('main')
  const container = document.createElement('section'), sidebar = document.createElement('aside'), navigationHost = document.createElement('aside')
  shell.className = 'app-shell screen-interface archive-page'
  main.className = 'main-layout'
  container.className = 'editor-column'
  sidebar.className = 'right-sidebar'
  main.append(navigationHost, container, sidebar); shell.append(main); document.body.append(shell)
  let root = createRoot(container)
  let wordCount
  const onWordCountChange = (_channel, count) => { wordCount = count }
  const render = async (channel = 'feed', owner = userId) => {
    await act(async () => root.render(createElement(OwnerPublications, { key: `${owner}:${channel}`, userId: owner, channel, onWordCountChange, metadataHost: sidebar })))
    await settle(() => !container.querySelector('[role=status]'))
  }
  return { userId, text, source, records, newer, tied, others, repo, container, sidebar, navigationHost, render, get wordCount() { return wordCount },
    async renderApp() {
      globalThis.__ownerTodayFixture = { userId, text: 'Сегодня', status: 'saved', ready: true,
        localProfile: { userId, displayName: 'Owner', dailyWordGoal: 1000 }, flush: async () => {},
        endWriting() {}, updateSetting() {}, dayEndsAt: Date.now() + 100000, graceUntil: null }
      const { default: App } = await server.ssrLoadModule('/src/App.jsx')
      await act(async () => root.render(createElement(App)))
    },
    async renderArchive() {
      await act(async () => root.render(createElement(MyTexts, { userId, flush: async () => {}, onTotalWords() {}, onExit() {}, metadataHost: sidebar, navigationHost })))
      await settle(() => container.querySelector('[data-text-id]'))
      await act(async () => { await all() })
    },
    async remount() { await act(async () => root.unmount()); (await openDatabase()).onversionchange(); root = createRoot(container); await render() },
    async close() { await act(async () => root.unmount()); shell.remove() } }
}

test('owner channels read immutable snapshot, preserve B/I/U and exact title, exclude private metadata and foreign owners, stable newest ordering after reopen', async () => {
  const f = await fixture()
  try {
    await transaction(['texts'], 'readwrite', tx => tx.objectStore('texts').put({ ...f.text, content: 'CHANGED SOURCE', document: undefined, contentFormat: undefined, revision: 4 }))
    const db = await openDatabase(), originalTransaction = db.transaction
    const readStores = []
    db.transaction = function (names, ...args) { readStores.push([...names]); return originalTransaction.call(this, names, ...args) }
    try { await f.render() } finally { db.transaction = originalTransaction }
    assert.equal(f.wordCount, 5, 'sum comes from channel snapshots despite changed source and foreign publications')
    assert.deepEqual(readStores, [['publications']], 'owner view never reads archive source')
    const articles = [...f.container.querySelectorAll('article')]
    for (const article of articles) {
      assert.equal(article.querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'false')
      await click(article.querySelector('[aria-expanded]'))
    }
    assert.deepEqual(articles.map(node => node.querySelector('.owner-publication-text').textContent), ['alpha', ' beta', 'alpha beta gamma'])
    assert.deepEqual([...f.sidebar.querySelectorAll('time')].map(node => node.dateTime), [new Date(200).toISOString(), new Date(200).toISOString(), new Date(100).toISOString()])
    assert.equal(articles[0].querySelector('h2').textContent, 'Без названия', 'fragment gets only a presentation placeholder')
    assert.equal(articles[2].querySelector('h2').textContent, 'Saved title')
    for (const mark of ['strong', 'em', 'u']) assert.equal(articles[2].querySelector(mark).textContent, 'alpha beta gamma')
    for (const privateValue of ['CHANGED SOURCE', 'PRIVATE TAG', 'PRIVATE OWNER', 'FOREIGN CONTENT', f.text.textId, f.text.userDayId, 'sourceRevision', 'contentSha256']) assert.equal(f.container.textContent.includes(privateValue), false)
    assert.equal(f.records[1].authorVisibility, 'hidden', 'hidden is visible to its owner')
    await f.render('profile'); assert.equal(f.container.querySelectorAll('article').length, 1)
    await f.render('internet'); assert.equal(f.container.querySelectorAll('article').length, 1)
    await f.remount(); assert.equal(f.container.querySelectorAll('article').length, 3)
  } finally { await f.close() }
})

test('owner delete needs confirmation, cancel preserves data, removes only chosen object, source/other channels unchanged and foreign delete rejected', async () => {
  const f = await fixture()
  try {
    await f.render()
    const before = await all()
    await click(button(f.container, 'Снять с публикации'))
    assert.ok(f.container.parentElement.textContent.includes('Снять публикацию из Ленты?'))
    assert.deepEqual(await all(), before)
    await click(button(f.container, 'Отмена')); assert.deepEqual(await all(), before)
    await click(button(f.container, 'Снять с публикации')); await click(button(f.container, 'Снять'))
    await settle(() => f.container.querySelectorAll('article').length === 2)
    const after = await all()
    assert.deepEqual(sourceStores(after), sourceStores(before))
    assert.deepEqual(after.publications, before.publications.filter(p => p.publicationId !== f.newer.publicationId))
    await assert.rejects(deletePublication(f.userId, `${f.others[0]}-0`), /unavailable to owner/)
    assert.deepEqual(await all(), after)
    await f.render('internet'); await click(button(f.container, 'Снять с публикации'))
    assert.ok(f.container.parentElement.textContent.includes('Снять публикацию из Интернета?'))
    await click(button(f.container, 'Снять')); await settle(() => f.container.textContent.includes('Здесь пока нет публикаций.'))
    await f.render('profile'); await click(button(f.container, 'Снять с публикации'))
    assert.ok(f.container.parentElement.textContent.includes('Снять публикацию из Профиля?'))
  } finally { await f.close() }
})

test('cards default collapsed, placeholders are presentation-only, dates differ, and expansion never changes the snapshot', async () => {
  const f = await fixture()
  try {
    const before = await all()
    await f.render()
    const articles = [...f.container.querySelectorAll('article')]
    for (const article of articles) {
      assert.equal(article.querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'false')
      const preview = article.querySelector('.owner-publication-preview')
      assert.ok(preview)
      assert.equal(preview.querySelector('.owner-publication-ellipsis'), null, 'short snapshot is shown once, without ellipsis')
      assert.equal(getComputedStyle(article.querySelector('.owner-publication-measurement')).height, '0px', 'measurement does not lengthen the scroll content')
      assert.equal(article.querySelector('.owner-publication-written').textContent, 'Написано 7 октября 2026')
      assert.equal(article.querySelector('time').dateTime, '2026-10-07')
    }
    assert.equal(articles[0].querySelector('h2').textContent, 'Без названия')
    assert.equal(articles[2].querySelector('h2').textContent, 'Saved title')
    assert.ok(f.sidebar.querySelector('time').dateTime.startsWith('1970-01-01'), 'publishedAt stays separate from the writing day')
    await click(articles[2])
    assert.equal(articles[2].querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'true')
    assert.equal(articles[2].querySelector('.owner-publication-preview'), null)
    assert.equal(articles[2].querySelector('.owner-publication-text').textContent, 'alpha beta gamma')
    for (const mark of ['strong', 'em', 'u']) assert.equal(articles[2].querySelector(mark).textContent, 'alpha beta gamma')
    await click(articles[2].querySelector('.owner-publication-text'))
    assert.equal(articles[2].querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'true', 'reading/selecting text is not a collapse target')
    await click(articles[2].querySelector('[aria-expanded]'))
    assert.equal(articles[2].querySelector('[aria-expanded]').getAttribute('aria-expanded'), 'false')
    assert.equal(articles[2].querySelector('.owner-publication-preview').textContent, 'alpha beta gamma')
    assert.deepEqual(await all(), before, 'placeholder, preview, dates, expansion never write data')
    await f.remount()
    assert.ok([...f.container.querySelectorAll('[aria-expanded]')].every(node => node.getAttribute('aria-expanded') === 'false'))
  } finally { await f.close() }
})

for (const expanded of [false, true]) {
  test(`card deletion in ${expanded ? 'expanded' : 'collapsed'} state uses confirmation and preserves source and other channels`, async () => {
    const f = await fixture()
    try {
      const before = await all()
      await f.render('profile')
      const article = f.container.querySelector('article')
      if (expanded) await click(article.querySelector('[aria-expanded]'))
      const metadata = f.sidebar.querySelector('.owner-publication-metadata')
      await click(button(f.container, 'Снять с публикации'))
      assert.equal(metadata.querySelector('button.is-active').textContent, 'Отмена')
      assert.equal(metadata.children.length, 2)
      await click(button(f.container, 'Отмена'))
      assert.equal(metadata.children[1].textContent, 'Снять с публикации')
      assert.equal(article.querySelector('[aria-expanded]').getAttribute('aria-expanded'), String(expanded))
      assert.deepEqual(await all(), before)
      await click(button(f.container, 'Снять с публикации'))
      await click(button(f.container, 'Снять'))
      await settle(() => f.container.querySelector('article') === null)
      const after = await all()
      assert.deepEqual(sourceStores(after), sourceStores(before))
      assert.deepEqual(after.publications, before.publications.filter(record => record.publicationId !== f.records[0].publicationId))
      assert.equal(f.wordCount, 0)
    } finally { await f.close() }
  })
}

test('collapsed card shows measured head/ellipsis/tail, preserves marks, and recomputes its preview when wrapping changes', async () => {
  const f = await fixture()
  const originalRects = dom.window.Range.prototype.getClientRects
  const originalBounds = dom.window.Range.prototype.getBoundingClientRect
  let columns = 1
  const rect = index => ({ top: 100 + Math.floor(index / columns) * 31, bottom: 123 + Math.floor(index / columns) * 31, height: 23 })
  dom.window.Range.prototype.getClientRects = function () {
    const result = []
    for (let index = this.startOffset; index < this.endOffset; index += columns) result.push(rect(index))
    return result
  }
  dom.window.Range.prototype.getBoundingClientRect = function () { return rect(this.startOffset) }
  try {
    const before = await all()
    await f.render('profile')
    const preview = f.container.querySelector('.owner-publication-preview')
    assert.equal(preview.textContent, 'alp…mma')
    assert.equal(preview.querySelectorAll('.owner-publication-ellipsis').length, 1)
    for (const mark of ['strong', 'em', 'u']) assert.deepEqual([...preview.querySelectorAll(mark)].map(node => node.textContent), ['alp', 'mma'])
    columns = 3
    await act(async () => window.dispatchEvent(new dom.window.Event('resize')))
    assert.equal(preview.textContent, 'alpha beta gamma')
    assert.equal(preview.querySelector('.owner-publication-ellipsis'), null)
    await click(f.container.querySelector('[aria-expanded]'))
    assert.equal(f.container.querySelector('.owner-publication-text').textContent, 'alpha beta gamma')
    assert.deepEqual(await all(), before)
  } finally {
    dom.window.Range.prototype.getClientRects = originalRects
    dom.window.Range.prototype.getBoundingClientRect = originalBounds
    await f.close()
  }
})


test('archive return derives collapsed publication summary from store; deleting the last object removes it without source flags', async () => {
  const f = await fixture()
  try {
    await f.renderArchive()
    await settle(() => f.sidebar.querySelector('.archive-publication-summary'))
    const before = sourceStores(await all())
    const navButton = text => [...f.navigationHost.querySelectorAll('nav button')].find(node => (node.querySelector('.owner-publication-channel-label')?.textContent ?? node.textContent) === text)
    await click(navButton('Публикации'))
    await settle(() => f.container.querySelector('.owner-publications'))
    for (const label of ['Профиль', 'Лента', 'Интернет']) {
      await click(navButton(label))
      await settle(() => f.container.querySelector('article'))
      while (f.container.querySelector('article')) {
        const count = f.container.querySelectorAll('article').length
        await click(button(f.container.querySelector('.owner-publications'), 'Снять с публикации'))
        await click(button(f.container.querySelector('.owner-publications'), 'Снять'))
        await settle(() => f.container.querySelectorAll('article').length === count - 1 &&
          f.container.querySelector('.owner-publications').getAttribute('aria-busy') === 'false')
      }
    }
    await click(navButton('←'))
    await act(async () => { await all() })
    assert.equal(f.sidebar.querySelector('.archive-publication-summary'), null)
    assert.deepEqual(sourceStores(await all()), before)
  } finally { await f.close() }
})

test('publications replace visible archive UI; snapshots form a vertical flow inside a fixed archive-style frame and navigation has one active level', async () => {
  const f = await fixture()
  try {
    await f.renderArchive()
    await click(f.container.querySelector('[aria-controls="archive-calendar"]'))
    assert.ok(f.container.querySelector('#archive-calendar'))
    const archive = f.container.querySelector('.my-texts')
    const archiveColumnOverflow = getComputedStyle(f.container).overflowY
    assert.equal(getComputedStyle(archive).display, 'flex')
    const navButton = text => [...f.navigationHost.querySelectorAll('nav button')].find(node => (node.querySelector('.owner-publication-channel-label')?.textContent ?? node.textContent) === text)
    const assertOnlyPublicationsVisible = () => {
      assert.equal(getComputedStyle(archive).display, 'none', 'real app CSS must not override hidden archive')
      for (const selector of ['.archive-calendar-controls', '.archive-scroll', '[data-text-id]']) {
        assert.ok(archive.querySelector(selector), 'archive state remains mounted for return')
        assert.equal(archive.querySelector(selector).closest('[hidden]'), archive, 'archive-only content is outside the visible view')
      }
      assert.equal(f.sidebar.querySelector('.archive-day-metadata, .archive-actions, .semantic-rail'), null, 'no archive metadata/actions in right column')
      const view = f.container.querySelector('.owner-publications')
      assert.equal(getComputedStyle(view).display, 'flex')
      assert.equal(getComputedStyle(view).flexDirection, 'column', 'frame stacks header and content rather than arranging texts in columns')
      assert.equal(getComputedStyle(view).overflow, 'hidden', 'frame stays outside the scrolling content')
      assert.equal(getComputedStyle(view).minHeight, '0px', 'frame is bounded by the same viewport as archive')
      assert.equal(getComputedStyle(view).flexGrow, '1')
      const scroller = view.querySelector('.owner-publications-scroll')
      assert.equal(scroller.parentElement, view)
      assert.ok(scroller.classList.contains('archive-scroll'), 'reuse the archive scrolling pattern')
      assert.equal(getComputedStyle(scroller).overflowY, 'auto')
      assert.equal(getComputedStyle(scroller).minHeight, '0px')
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        assert.equal(getComputedStyle(view)[`border${side}Style`], getComputedStyle(archive)[`border${side}Style`])
        assert.equal(getComputedStyle(view)[`border${side}Width`], getComputedStyle(archive)[`border${side}Width`])
        assert.equal(getComputedStyle(view)[`border${side}Color`], getComputedStyle(archive)[`border${side}Color`])
      }
      assert.equal(getComputedStyle(f.container).overflowY, archiveColumnOverflow, 'column does not scroll the frame')
    }
    await click(navButton('Публикации'))
    await settle(() => f.container.querySelector('.owner-publications'))
    assertOnlyPublicationsVisible()
    const parent = [...f.navigationHost.querySelectorAll('span.menu-item')].find(node => node.textContent === 'Публикации')
    assert.equal(parent.classList.contains('is-active'), false, 'initial entry selects the first nonempty channel')
    assert.equal(navButton('Профиль').getAttribute('aria-current'), 'true')
    for (const label of ['Лента', 'Профиль', 'Интернет']) {
      await click(navButton(label))
      await settle(() => f.container.querySelector('article'))
      assertOnlyPublicationsVisible()
      assert.equal(parent.classList.contains('is-active'), false, 'parent must not compete with the active channel')
      assert.equal(f.navigationHost.querySelectorAll('.is-active').length, 1)
      assert.equal(navButton(label).getAttribute('aria-current'), 'true')
      assert.equal(getComputedStyle(navButton(label).parentElement).paddingLeft, '18px')
      const view = f.container.querySelector('.owner-publications'), articles = [...view.querySelectorAll('article')]
      assert.equal(articles.length, label === 'Лента' ? 3 : 1)
      for (const article of articles) {
        assert.equal(article.parentElement, view.querySelector('.owner-publications-content'), 'snapshots are consecutive elements in one reading flow')
        assert.equal(getComputedStyle(article).display, 'block')
        assert.equal(getComputedStyle(article.querySelector('.owner-publication-text')).display, 'block')
      }
    }
    await click(navButton('←'))
    assert.equal(getComputedStyle(archive).display, 'flex')
    assert.ok(f.container.querySelector('#archive-calendar'), 'calendar expansion survives view switches')
    assert.equal(getComputedStyle(f.container).overflowY, archiveColumnOverflow, 'publication scrolling does not affect archive mode')
  } finally { await f.close() }
})

const navControl = (f, text) => [...f.navigationHost.querySelectorAll('nav button')].find(node =>
  (node.querySelector('.owner-publication-channel-label')?.textContent ?? node.textContent) === text)
const navCounts = f => [...f.navigationHost.querySelectorAll('.owner-publication-count')].map(node => Number(node.textContent))

for (const label of ['Профиль', 'Лента', 'Интернет']) {
  test(`${label} back returns directly to the preserved archive without a Publications view or active group`, async () => {
    const f = await fixture()
    try {
      await f.renderArchive()
      await click(f.container.querySelector('[aria-controls="archive-calendar"]'))
      await click([...f.container.querySelectorAll('[aria-label="Годы"] button')].find(node => node.textContent === '2026'))
      await click(f.container.querySelector('.archive-preview-button'))
      const archive = f.container.querySelector('.my-texts'), scroller = archive.querySelector('.archive-scroll')
      const criterion = archive.querySelector('[aria-label="Снять выбранный период"]').parentElement.textContent
      assert.ok(archive.querySelector('.saved-text'))
      scroller.scrollTop = 120
      const before = await all()
      await click(navControl(f, 'Публикации'))
      await settle(() => f.container.querySelector('.owner-publications article'))
      await click(navControl(f, label))
      await settle(() => f.container.querySelector('h1')?.textContent === label)
      const group = [...f.navigationHost.querySelectorAll('.menu-item')].find(node => node.textContent === 'Публикации')
      assert.equal(group.classList.contains('is-active'), false)
      assert.equal(group.hasAttribute('aria-current'), false)
      assert.equal(f.container.querySelector('h1').textContent, label)
      assert.equal(f.navigationHost.querySelector('[aria-label="Вернуться в Мои тексты"]').textContent, '←')
      await click(navControl(f, '←'))
      assert.equal(f.container.querySelector('.owner-publications'), null, 'no intermediate central view')
      assert.equal(f.container.querySelector('h1'), null, 'no Publications heading')
      assert.equal(archive.hidden, false)
      assert.equal(f.container.querySelector('.my-texts'), archive, 'archive remains mounted')
      assert.ok(navControl(f, 'Поиск'))
      assert.ok(navControl(f, 'Публикации'))
      assert.equal(f.navigationHost.querySelector('.my-texts-publications.is-active'), null)
      assert.equal(archive.querySelector('[aria-label="Снять выбранный период"]').parentElement.textContent, criterion)
      assert.ok(archive.querySelector('.saved-text'), 'opened record remains opened')
      assert.equal(scroller.scrollTop, 120)
      assert.deepEqual(await all(), before, 'navigation changes no stored data')
    } finally { await f.close() }
  })
}

async function keepChannels(f, channels) {
  for (const channel of ['profile', 'feed', 'internet']) {
    if (!channels.includes(channel)) {
      for (const record of await f.repo.listOwnPublications(f.userId, channel)) await f.repo.deletePublication(f.userId, record.publicationId)
    }
  }
}

for (const [channels, expected, counts] of [
  [['profile', 'feed', 'internet'], 'Профиль', [1, 3, 1]],
  [['feed', 'internet'], 'Лента', [0, 3, 1]],
  [['internet'], 'Интернет', [0, 0, 1]],
]) {
  test(`general publication entry selects first nonempty owner channel: ${expected}`, async () => {
    const f = await fixture()
    try {
      await keepChannels(f, channels)
      const before = await all()
      await f.renderArchive(); await click(navControl(f, 'Публикации'))
      await settle(() => f.container.querySelector(`[aria-label="Публикации: ${expected}"] article`))
      assert.equal(navControl(f, expected).getAttribute('aria-current'), 'true')
      assert.deepEqual(navCounts(f), counts)
      assert.equal(f.container.querySelector('h1').textContent, expected, 'header has only the channel name, no count')
      assert.equal(getComputedStyle(f.container.querySelector('h1')).position, 'sticky')
      assert.deepEqual(await all(), before, 'entry only reads owner publications')
    } finally { await f.close() }
  })
}

test('all-empty general entry shows the general empty state without a root view; explicit empty channel stays open', async () => {
  const f = await fixture()
  try {
    await keepChannels(f, [])
    await f.renderArchive(); await click(navControl(f, 'Публикации'))
    await settle(() => f.container.querySelector('[aria-label="Публикации: Профиль"]')?.textContent.includes('Публикаций нет.'))
    assert.deepEqual(navCounts(f), [0, 0, 0])
    assert.equal(f.container.querySelector('h1').textContent, 'Профиль')
    assert.equal(navControl(f, 'Профиль').getAttribute('aria-current'), 'true')
    assert.equal(f.container.querySelector('article'), null, 'foreign feed publications do not count')
    assert.equal(f.navigationHost.querySelector('[aria-current="true"]').textContent.includes('Публикации'), false)
    for (const label of ['Профиль', 'Лента', 'Интернет']) {
      await click(navControl(f, label))
      await settle(() => f.container.querySelector(`[aria-label="Публикации: ${label}"]`)?.textContent.includes('Здесь пока нет публикаций.'))
      assert.equal(navControl(f, label).getAttribute('aria-current'), 'true')
      assert.deepEqual(navCounts(f), [0, 0, 0])
    }
  } finally { await f.close() }
})

test('delete last feed publication updates counts but keeps the chosen empty channel despite other nonempty channels; entry refreshes after archive create', async () => {
  const f = await fixture()
  try {
    await f.repo.deletePublication(f.userId, f.newer.publicationId)
    await f.repo.deletePublication(f.userId, f.tied.publicationId)
    const before = sourceStores(await all())
    await f.renderArchive(); await click(navControl(f, 'Публикации'))
    await settle(() => f.container.querySelector('[aria-label="Публикации: Профиль"] article'))
    assert.deepEqual(navCounts(f), [1, 1, 1])
    await click(navControl(f, 'Лента'))
    await settle(() => f.container.querySelector('[aria-label="Публикации: Лента"] article'))
    await click(button(f.container, 'Снять с публикации')); await click(button(f.container, 'Отмена'))
    assert.deepEqual(navCounts(f), [1, 1, 1], 'cancel never changes counts')
    await click(button(f.container, 'Снять с публикации')); await click(button(f.container, 'Снять'))
    await settle(() => f.container.querySelector('[aria-label="Публикации: Лента"]')?.textContent.includes('Здесь пока нет публикаций.'))
    assert.equal(navControl(f, 'Лента').getAttribute('aria-current'), 'true')
    assert.deepEqual(navCounts(f), [1, 0, 1])
    await click(navControl(f, 'Профиль')); await settle(() => f.container.querySelector('[aria-label="Публикации: Профиль"] article'))
    await click(navControl(f, 'Лента'))
    await settle(() => f.container.querySelector('[aria-label="Публикации: Лента"]')?.textContent.includes('Здесь пока нет публикаций.'))
    assert.equal(navControl(f, 'Лента').getAttribute('aria-current'), 'true', 'explicit zero-count channel is never auto-switched')
    await click(navControl(f, '←'))
    assert.equal(f.container.querySelector('article'), null, 'back returns to archive without repeating entry auto-selection')
    assert.equal(f.container.querySelector('.my-texts').hidden, false)
    await act(async () => {
      await f.repo.createPublications(f.userId, { source: f.source, channels: ['feed'] })
    })
    await click(navControl(f, 'Публикации'))
    await settle(() => f.container.querySelector('[aria-label="Публикации: Профиль"] article'))
    assert.deepEqual(navCounts(f), [1, 1, 1], 'fresh general entry rereads counts after archive creation')
    assert.deepEqual(sourceStores(await all()), before)
  } finally { await f.close() }
})

test('App publication footer derives channel snapshot words, updates after delete/create, stays zero in empty channel and restores normal footer outside publications', async () => {
  const f = await fixture()
  try {
    const before = sourceStores(await all())
    await f.renderApp()
    const footer = () => f.container.querySelector('footer').textContent.trim()
    const control = text => [...f.container.querySelectorAll('nav button')].find(node =>
      (node.querySelector('.owner-publication-channel-label')?.textContent ?? node.textContent) === text)
    assert.ok(footer().includes('Сохранено'), 'today save status remains unchanged')
    await click(control('Мои тексты'))
    await settle(() => f.container.querySelector('[data-text-id]'))
    assert.ok(footer().includes('Написано'))
    await click(control('Публикации'))
    await settle(() => footer() === 'Опубликовано 3 слова')
    await click(control('Профиль'))
    assert.equal(footer(), 'Опубликовано 3 слова', 'clicking the current channel keeps the derived total')
    await click(control('Лента'))
    await settle(() => footer() === 'Опубликовано 5 слов')
    await click(button(f.container, 'Снять с публикации')); await click(button(f.container, 'Отмена'))
    assert.equal(footer(), 'Опубликовано 5 слов', 'cancel does not affect derived words')
    for (const expected of [4, 3, 0]) {
      await click(button(f.container, 'Снять с публикации')); await click(button(f.container, 'Снять'))
      await settle(() => footer() === `Опубликовано ${expected} ${expected === 0 ? 'слов' : 'слова'}` &&
        f.container.querySelector('.owner-publications').getAttribute('aria-busy') === 'false')
    }
    assert.equal(control('Лента').getAttribute('aria-current'), 'true')
    await click(control('Интернет')); await settle(() => footer() === 'Опубликовано 3 слова')
    await click(control('←'))
    assert.ok(footer().includes('Написано'))
    await act(async () => { await f.repo.createPublications(f.userId, { source: f.source, channels: ['feed'] }) })
    await click(control('Публикации')); await settle(() => footer() === 'Опубликовано 3 слова')
    await click(control('Лента')); await settle(() => footer() === 'Опубликовано 3 слова')
    assert.deepEqual(sourceStores(await all()), before, 'summary writes no source or settings')
    await click(control('←')); await click(control('←'))
    assert.ok(footer().includes('Сохранено'), 'today keeps its existing save status after returning')
    assert.equal(footer().includes('Опубликовано'), false)
  } finally { await f.close() }
})

test('publication header reuses calendar row spacing; right metadata stick within each snapshot and are clipped below the header', async () => {
  const f = await fixture()
  try {
    await f.renderArchive()
    const archiveStyle = getComputedStyle(f.container.querySelector('.my-texts'))
    const calendarRowStyle = getComputedStyle(f.container.querySelector('.archive-calendar-heading'))
    const calendarControlsStyle = getComputedStyle(f.container.querySelector('.archive-calendar-controls'))
    const archiveGapStyle = getComputedStyle(f.container.querySelector('.archive-actions-space'))
    await f.render()
    const header = f.container.querySelector('h1'), headerStyle = getComputedStyle(header)
    const rowStyle = getComputedStyle(header.querySelector('.archive-calendar-heading'))
    assert.equal(rowStyle.height, calendarRowStyle.height)
    assert.equal(rowStyle.lineHeight, calendarRowStyle.lineHeight)
    assert.equal(rowStyle.alignItems, calendarRowStyle.alignItems)
    assert.equal(headerStyle.paddingTop, archiveStyle.paddingTop)
    assert.equal(headerStyle.paddingBottom, calendarControlsStyle.paddingBottom)
    assert.equal(headerStyle.marginBottom, archiveGapStyle.height)
    for (const token of ['--reading-header-top-space', '--reading-header-bottom-space', '--reading-content-gap']) {
      assert.equal(headerStyle.getPropertyValue(token), archiveStyle.getPropertyValue(token))
    }
    assert.equal(headerStyle.position, 'sticky')
    assert.equal(headerStyle.top, '0px')
    assert.equal(headerStyle.backgroundColor, 'rgb(255, 255, 255)')
    assert.equal(getComputedStyle(f.container.querySelector('.owner-publications')).paddingTop, '0px')
    const mask = [...style.sheet.cssRules].find(rule => rule.selectorText === '.owner-publications-scroll > h1::before')
    assert.equal(mask, undefined, 'no opaque mask above or below the single sticky line')
    const viewStyle = getComputedStyle(f.container.querySelector('.owner-publications'))
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      assert.equal(viewStyle[`border${side}Style`], 'solid')
      assert.equal(viewStyle[`border${side}Width`], '1px')
      assert.equal(viewStyle[`border${side}Color`], 'rgb(217, 217, 217)')
    }
    const scroller = f.container.querySelector('.owner-publications-scroll')
    assert.equal(getComputedStyle(scroller).scrollbarWidth, 'none')
    assert.equal(f.container.querySelector('.owner-publication-confirmation, .owner-publication-heading'), null, 'owner controls stay outside the central reading flow')
    assert.ok([...f.container.querySelectorAll('time')].every(time => time.closest('.owner-publication-written')), 'only writing dates appear centrally')
    const articles = [...f.container.querySelectorAll('article')], notes = [...f.sidebar.querySelectorAll('.owner-publication-metadata')]
    assert.equal(notes.length, articles.length)
    assert.equal(getComputedStyle(notes[0]).flexDirection, 'column', 'removal action is below the date')
    assert.equal(notes[0].firstElementChild.tagName, 'TIME')
    assert.equal(notes[0].children[1].textContent, 'Снять с публикации')
    let scroll = 0
    scroller.getBoundingClientRect = () => ({ top: 100, bottom: 600 })
    f.sidebar.getBoundingClientRect = () => ({ top: 80 })
    header.getBoundingClientRect = () => ({ bottom: 168 })
    for (let i = 0; i < articles.length; i++) {
      articles[i].getBoundingClientRect = () => ({ top: 200 + i * 540 - scroll, bottom: 700 + i * 540 - scroll })
      const content = articles[i].querySelector('h2') ?? articles[i].querySelector('.owner-publication-text')
      content.getBoundingClientRect = () => ({ top: 200 + i * 540 - scroll })
      notes[i].getBoundingClientRect = () => ({ height: 60 })
    }
    const before = await all()
    await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll')))
    const rail = f.sidebar.querySelector('.owner-publication-rail')
    assert.equal(rail.style.top, '96px', 'rail begins below actual sticky header and an 8px gap')
    assert.equal(rail.style.height, '424px')
    assert.equal(getComputedStyle(rail).overflow, 'hidden')
    assert.equal(notes[0].style.top, '24px', 'date starts alongside publication content')
    scroll = 250
    await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll')))
    assert.equal(notes[0].style.top, '0px', 'date and action remain at the rail top while snapshot continues')
    scroll = 650
    await act(async () => scroller.dispatchEvent(new dom.window.Event('scroll')))
    assert.ok(parseFloat(notes[0].style.top) <= -60, 'previous publication metadata leaves the viewport completely')
    assert.equal(notes[1].style.top, '0px', 'next publication replaces previous sticky metadata')
    await click(notes[1].querySelector('button'))
    assert.ok(f.sidebar.querySelector('[aria-label="Подтверждение снятия публикации"]'))
    await click(button(f.container, 'Отмена'))
    assert.deepEqual(await all(), before, 'layout/scroll/cancel write no user data')
  } finally { await f.close() }
})

test('wheel over publication text stays native; right metadata wheel scrolls content inside the fixed frame rather than the column or hidden archive', async () => {
  const f = await fixture()
  try {
    await f.renderApp()
    const control = text => [...f.container.querySelectorAll('nav button')].find(node =>
      (node.querySelector('.owner-publication-channel-label')?.textContent ?? node.textContent) === text)
    await click(control('Мои тексты')); await settle(() => f.container.querySelector('[data-text-id]'))
    const archiveScroller = f.container.querySelector('.archive-scroll'), before = archiveScroller.scrollTop
    await click(control('Публикации')); await settle(() => f.container.querySelector('.owner-publication-text'))
    const frame = f.container.querySelector('.owner-publications')
    const column = frame.closest('.editor-column'), columnBefore = column.scrollTop
    const scroller = frame.querySelector('.owner-publications-scroll')
    const native = new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 })
    await act(async () => f.container.querySelector('.owner-publication-text').dispatchEvent(native))
    assert.equal(native.defaultPrevented, false, 'native wheel/trackpad scrolling is not intercepted over text')
    assert.equal(archiveScroller.scrollTop, before)
    const marginal = new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
    await act(async () => f.container.querySelector('.owner-publication-metadata').dispatchEvent(marginal))
    assert.equal(marginal.defaultPrevented, true)
    assert.equal(scroller.scrollTop, 120)
    assert.equal(column.scrollTop, columnBefore, 'outer column does not scroll the frame')
    assert.equal(frame.scrollTop, 0, 'all four borders belong to a non-scrolling shell')
    assert.equal(archiveScroller.scrollTop, before)
    await click(control('←'))
    const restored = new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 })
    await act(async () => f.container.querySelector('.right-sidebar').dispatchEvent(restored))
    assert.equal(archiveScroller.scrollTop, before + 10, 'return restores archive wheel routing')
  } finally { await f.close() }
})

test('removal action is replaced by confirmation in the same metadata slot; cancel restores action and remains the default', async () => {
  const f = await fixture()
  try {
    await f.render('profile')
    const before = await all()
    const metadata = f.sidebar.querySelector('.owner-publication-metadata')
    const date = metadata.firstElementChild
    assert.equal(metadata.children.length, 2)
    assert.equal(metadata.children[1].textContent, 'Снять с публикации')
    assert.equal(metadata.querySelector('.owner-publication-confirmation'), null)
    await click(metadata.children[1])
    const confirmation = f.sidebar.querySelector('.owner-publication-confirmation')
    assert.equal(metadata.firstElementChild, date, 'date and metadata placement stay intact')
    assert.equal(metadata.children.length, 2)
    assert.equal(metadata.children[1], confirmation, 'confirmation replaces the action beneath the date')
    assert.equal([...metadata.querySelectorAll('button')].some(node => node.textContent === 'Снять с публикации'), false)
    const actions = confirmation.querySelector('.owner-publication-confirmation-actions')
    assert.equal(confirmation.firstElementChild.textContent, 'Снять публикацию из Профиля?')
    assert.equal(confirmation.children[1], actions)
    assert.equal(getComputedStyle(confirmation).flexDirection, 'column')
    assert.equal(getComputedStyle(actions).flexWrap, 'nowrap')
    assert.deepEqual([...actions.children].map(node => node.textContent), ['Снять', 'Отмена'])
    const [remove, cancel] = actions.children
    assert.equal(document.activeElement, cancel)
    assert.equal(cancel.classList.contains('is-active'), true)
    assert.equal(remove.classList.contains('is-active'), false)
    assert.equal(getComputedStyle(cancel).color, 'rgb(38, 38, 38)')
    assert.equal(getComputedStyle(cancel).fontWeight, '600')
    await act(async () => remove.focus())
    assert.equal(remove.classList.contains('is-active'), true)
    assert.equal(cancel.classList.contains('is-active'), false)
    await act(async () => cancel.focus())
    await click(cancel)
    assert.equal(f.sidebar.querySelector('.owner-publication-confirmation'), null)
    assert.equal(metadata.children.length, 2)
    assert.equal(metadata.firstElementChild, date)
    assert.equal(metadata.children[1].textContent, 'Снять с публикации')
    assert.deepEqual(await all(), before)
    await click(button(f.container, 'Снять с публикации'))
    assert.equal(document.activeElement.textContent, 'Отмена', 'each confirmation resets the default action')
    assert.equal(metadata.children[1].classList.contains('owner-publication-confirmation'), true)
  } finally { await f.close() }
})
