import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'
import { connectDatabase } from '../storage/database.js'
import { readFileSync } from 'node:fs'
import { createReaderFeedFixture } from '../testFixtures/readerFeed.js'

const dom = new JSDOM('<body></body>', { url: 'http://localhost/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'DOMParser', 'MutationObserver', 'getComputedStyle']) globalThis[key] = dom.window[key]
const rangeRect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
dom.window.Range.prototype.getBoundingClientRect = () => rangeRect
dom.window.Range.prototype.getClientRects = () => [rangeRect]
const style = document.createElement('style')
style.textContent = ['../index.css', '../App.css', '../MyTexts.css', './OwnerPublications.css', './ReaderFeed.css']
  .map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
document.head.append(style)
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
globalThis.IDBKeyRange = IDBKeyRange
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', plugins: [{ name: 'reader-app-fixture', enforce: 'pre', transform(code, id) {
  if (id.endsWith('/src/hooks/useTodayText.js')) return 'export const useTodayText = () => globalThis.__readerToday'
  if (id.endsWith('/src/components/ReaderFeed.jsx')) return code.replace('api = readerApi', 'api = globalThis.__readerApi ?? readerApi')
} }] })
const { default: ReaderFeed } = await server.ssrLoadModule('/src/components/ReaderFeed.jsx')
after(async () => { delete globalThis.__readerApi; delete globalThis.__readerToday; await server.close(); dom.window.close() })
const stores = ['settings', 'texts', 'userDays', 'wordCountSamples', 'publications']
const settle = async predicate => {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)))
  assert.ok(predicate())
}
const click = async node => { assert.ok(node); await act(async () => { node.click(); await new Promise(resolve => setTimeout(resolve, 5)) }) }
const button = (container, text) => [...container.querySelectorAll('button')].find(node => node.textContent === text)
async function fixture(t) {
  const factory = new IDBFactory(), name = `reader-feed-test-${crypto.randomUUID()}`
  let db = await connectDatabase({ factory, name })
  const accessed = []
  const runTransaction = (names, mode, run) => new Promise((resolve, reject) => {
    accessed.push({ names, mode })
    const tx = db.transaction(names, mode)
    let result, failure
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(failure || tx.error)
    tx.onerror = () => {}
    try { run(tx, value => { result = value }, error => { failure = error; tx.abort() }) }
    catch (error) { failure = error; tx.abort() }
  })
  const data = await createReaderFeedFixture({ runTransaction })
  const dump = () => runTransaction(stores, 'readonly', (tx, done) => {
    const result = {}; done(result)
    for (const store of stores) { const read = tx.objectStore(store).getAll(); read.onsuccess = () => { result[store] = read.result } }
  })
  const container = document.createElement('div'), sidebar = document.createElement('aside'), footer = document.createElement('footer')
  document.body.append(container, sidebar, footer)
  const root = createRoot(container)
  const mount = async () => {
    await act(async () => root.render(createElement(ReaderFeed, { userId: data.users[0], metadataHost: sidebar, statusHost: footer, api: data.api })))
    await settle(() => container.querySelectorAll('article').length > 0)
  }
  const refresh = async () => { await act(async () => window.dispatchEvent(new dom.window.Event('focus'))); await act(async () => new Promise(resolve => setTimeout(resolve, 20))) }
  t.after(async () => { await act(async () => root.unmount()); container.remove(); sidebar.remove(); footer.remove(); db.close() })
  return { ...data, container, sidebar, footer, root, accessed, runTransaction, dump, mount, refresh,
    reopen: async () => { db.close(); db = await connectDatabase({ factory, name }) } }
}

test('Reader Feed combines three authors with stable ordering, safe identity and immutable rich snapshot; no source reads', async t => {
  const f = await fixture(t)
  await f.runTransaction(['texts'], 'readwrite', tx => tx.objectStore('texts').put({ ...f.texts[0], content: 'CHANGED SOURCE', document: undefined, revision: 2 }))
  const before = await f.dump(); f.accessed.length = 0
  await f.mount()
  assert.ok(f.accessed.every(access => access.mode === 'readonly' && !access.names.includes('texts') && !access.names.includes('userDays')))
  const expected = await f.repo.listFeedPublications()
  const articles = [...f.container.querySelectorAll('article')]
  assert.equal(articles.length, 5)
  assert.deepEqual([...f.sidebar.querySelectorAll('time')].map(node => node.dateTime), [400, 300, 300, 200, 200].map(value => new Date(value).toISOString()))
  assert.deepEqual(articles.slice(1, 3).map(article => article.querySelector('.owner-publication-preview').textContent), ['alpha', 'alpha beta gamma 2'], 'same-time ID tie-break stays stable')
  assert.deepEqual(articles.map(article => article.querySelector('.owner-publication-preview').textContent), expected.map(record => record.snapshot.content))
  for (const article of articles) assert.equal(article.querySelector('h2 button[aria-expanded]').getAttribute('aria-expanded'), 'false')
  assert.equal(f.sidebar.querySelector('.reader-publication-author').textContent, '●Автор', 'hidden owner still recognized without exposing identity')
  assert.equal(f.container.querySelector('.reader-publication-author'), null, 'author metadata must not be in the reading flow')
  const named = articles.find(article => article.querySelector('h2').textContent === 'Snapshot title')
  assert.ok(named)
  const namedNote = f.sidebar.querySelectorAll('.owner-publication-metadata')[articles.indexOf(named)]
  assert.equal(namedNote.querySelector('.reader-publication-author').textContent, '●Mumipol›')
  assert.equal(f.sidebar.querySelectorAll('.reader-own-marker').length, 3)
  assert.equal(f.sidebar.textContent.includes('Моя публикация'), false)
  assert.ok(namedNote.querySelector('.reader-author-reveal'))
  const alias = [...f.sidebar.querySelectorAll('.owner-publication-metadata')].find(note => note.textContent.includes(f.publicProfiles[1].publicAlias))
  assert.ok(alias)
  assert.equal(alias.querySelector('.reader-author-reveal'), null)
  assert.ok(articles.some(article => article.querySelector('h2').textContent === 'Без названия'))
  assert.equal(named.querySelector('.owner-publication-written').textContent, 'Написано 7 октября 2026')
  assert.equal(f.sidebar.querySelector('time').dateTime, new Date(400).toISOString())
  assert.equal(namedNote.querySelector('.reader-author-disclosed'), null)
  await click(named.querySelector('h2 button[aria-expanded]'))
  assert.equal(named.querySelector('.owner-publication-text').textContent, f.texts[0].content)
  for (const tag of ['strong', 'em', 'u']) assert.ok(named.querySelector(tag))
  await click(named.querySelector('.owner-publication-text'))
  assert.equal(named.querySelector('h2 button[aria-expanded]').getAttribute('aria-expanded'), 'true')
  await click(named.querySelector('h2 button[aria-expanded]'))
  for (const secret of ['PRIVATE TAG', 'CHANGED SOURCE', 'HISTORICAL NAME', 'sourceRevision', ...f.users, ...f.texts.map(text => text.textId)]) {
    assert.equal((f.container.textContent + f.sidebar.textContent).includes(secret), false)
  }
  assert.deepEqual(await f.dump(), before)
})

test('author filtering uses publicId, survives live nickname rename and clears to the whole Feed', async t => {
  const f = await fixture(t); await f.mount()
  assert.equal(f.container.querySelector('h1'), null)
  await click(button(f.sidebar, 'Mumipol'))
  assert.equal(f.container.querySelector('h1').textContent, 'Mumipol×')
  assert.equal(f.container.querySelectorAll('article').length, 2)
  assert.equal(f.footer.textContent, 'Опубликовано 2 текста')
  const publications = (await f.dump()).publications
  const publicId = f.publicProfiles[0].publicId
  await f.identityRepo.savePublicNickname(f.users[0], 'Polevoy')
  await f.refresh()
  assert.equal(f.container.querySelectorAll('article').length, 2)
  assert.equal(f.container.querySelector('h1').textContent, 'Polevoy×')
  assert.equal((await f.identityRepo.loadPublicIdentity(f.users[0])).publicId, publicId)
  assert.deepEqual((await f.dump()).publications, publications)
  await click(f.container.querySelector('[aria-label="Сбросить фильтр автора"]'))
  assert.equal(f.container.querySelectorAll('article').length, 5)
  assert.equal(f.container.querySelector('h1'), null)
  assert.equal(f.footer.textContent, 'Опубликовано 5 текстов')
  await click(button(f.sidebar, f.publicProfiles[1].publicAlias))
  assert.equal(f.container.querySelectorAll('article').length, 1)
  assert.equal(f.footer.textContent, 'Опубликовано 1 текст')
})

test('disclosure uses current local/fixture names only on click; unavailable and revoked names stay unavailable', async t => {
  const f = await fixture(t); await f.mount()
  const own = [...f.sidebar.querySelectorAll('.owner-publication-metadata')].find(note => note.querySelector('.reader-author-name')?.textContent === 'Mumipol')
  assert.equal(own.textContent.includes('Current fixture name'), false)
  await click(own.querySelector('.reader-author-reveal'))
  assert.equal(own.querySelector('.reader-author-disclosed').textContent, 'Current fixture name 0')
  await click(own.querySelector('.reader-author-reveal'))
  assert.equal(own.querySelector('.reader-author-disclosed'), null)
  const foreign = [...f.sidebar.querySelectorAll('.owner-publication-metadata')].find(note => note.textContent.includes('Third'))
  f.currentNames.set(f.users[2], 'Updated fixture name')
  await click(foreign.querySelector('.reader-author-reveal'))
  assert.equal(foreign.querySelector('.reader-author-disclosed').textContent, 'Updated fixture name')
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ ...f.publicProfiles[2], allowNameDisclosure: false }))
  await f.refresh()
  assert.equal(foreign.querySelector('.reader-author-reveal'), null)
  assert.equal(foreign.querySelector('.reader-author-disclosed'), null)
  f.currentNames.delete(f.users[2])
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put(f.publicProfiles[2]))
  await f.refresh()
  assert.equal(foreign.querySelector('.reader-author-reveal'), null)
})

test('owner-only removal uses confirmation, isolates other channels/source and empty Feed has no CTA', async t => {
  const f = await fixture(t); await f.mount()
  assert.equal([...f.sidebar.querySelectorAll('button')].filter(node => node.textContent === 'Снять с публикации').length, 3, 'own visible and anonymous publications only')
  const before = await f.dump()
  await click(button(f.sidebar, 'Снять с публикации'))
  assert.equal(button(f.sidebar, 'Снять с публикации')?.closest('.owner-publication-metadata') === f.sidebar.firstChild.firstChild, false)
  assert.equal(f.sidebar.querySelector('.owner-publication-confirmation button.is-active').textContent, 'Отмена')
  await click(button(f.sidebar, 'Отмена'))
  assert.deepEqual(await f.dump(), before)
  await click(button(f.sidebar, 'Снять с публикации')); await click(button(f.sidebar, 'Снять'))
  await settle(() => f.container.querySelectorAll('article').length === 4)
  assert.equal(f.footer.textContent, 'Опубликовано 4 текста')
  const after = await f.dump()
  for (const store of stores.filter(store => store !== 'publications')) assert.deepEqual(after[store], before[store])
  assert.equal((await f.repo.listOwnPublications(f.users[0], 'feed')).length, 2)
  assert.deepEqual(after.publications.filter(record => record.channel !== 'feed'), before.publications.filter(record => record.channel !== 'feed'))
  const foreign = after.publications.find(record => record.userId === f.users[1])
  await assert.rejects(f.api.remove(f.users[0], foreign.publicationId), /owner/)
  assert.deepEqual(await f.dump(), after)
  await f.runTransaction(['publications'], 'readwrite', tx => after.publications.filter(record => record.channel === 'feed').forEach(record => tx.objectStore('publications').delete(record.publicationId)))
  await f.refresh()
  assert.ok(f.container.textContent.includes('Публикации отсутствуют.'))
  assert.equal(f.footer.textContent, 'Опубликовано 0 текстов')
  assert.ok(f.container.textContent.includes('Авторы ещё не готовы. Тексты зреют.'))
  assert.equal(f.container.querySelectorAll('button').length, 0)
})


test('existing Common page navigation renders Reader Feed without an extra global Feed item, preserves today editor and never composes archive/owner-only content', async t => {
  const f = await fixture(t)
  globalThis.__readerApi = f.api
  globalThis.__readerToday = { userId: f.users[0], localProfile: f.profiles[0], text: '', status: 'saved', ready: true,
    flush: async () => {}, endWriting() {}, updateSetting() {}, dayEndsAt: Date.now() + 100000, graceUntil: null }
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  await act(async () => f.root.render(createElement(App)))
  const editor = f.container.querySelector('.today-editor-shell')
  assert.equal(button(f.container.querySelector('nav'), 'Лента'), undefined)
  await click(button(f.container, 'Общая страница'))
  await settle(() => f.container.querySelectorAll('.reader-feed article').length === 5)
  assert.equal(editor.hidden, true)
  assert.equal(f.container.querySelector('.my-texts'), null)
  assert.equal(f.container.querySelector('.archive-calendar-controls'), null)
  assert.equal(f.container.querySelector('nav [aria-current=page]').textContent.trim(), 'Общая страница')
  const topbar = f.container.querySelector('.topbar')
  assert.equal(topbar.querySelector('.public-page-title').textContent, 'Общая страница')
  assert.equal(getComputedStyle(topbar.querySelector('.public-page-title')).fontSize, getComputedStyle(f.container.querySelector('nav [aria-current=page]')).fontSize)
  assert.equal(getComputedStyle(topbar.querySelector('.public-page-title')).fontWeight, '600')
  assert.equal(f.container.querySelector('.bottom-bar').textContent.trim(), 'Опубликовано 5 текстов')
  const date = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()).replace(/\s*г\.$/, '')
  assert.equal(topbar.querySelector('.public-page-date').textContent, date[0].toUpperCase() + date.slice(1))
  assert.equal(topbar.querySelector('.meta-user'), null)
  assert.equal(topbar.querySelector('.meta-countdown'), null)
  assert.equal(topbar.textContent.includes(f.profiles[0].displayName), false)
  assert.equal(f.container.querySelector('.reader-feed h1'), null)
  const publicHeader = topbar.querySelector('.public-page-header').textContent
  await click(button(f.container.querySelector('.right-sidebar'), 'Mumipol'))
  assert.equal(f.container.querySelector('.reader-feed h1').textContent, 'Mumipol×')
  assert.equal(f.container.querySelector('.bottom-bar').textContent.trim(), 'Опубликовано 2 текста')
  assert.equal(topbar.querySelector('.public-page-header').textContent, publicHeader)
  await click(f.container.querySelector('[aria-label="Сбросить фильтр автора"]'))
  assert.equal(f.container.querySelector('.reader-feed h1'), null)
  await click(button(f.container, 'Текст сегодня'))
  assert.ok(topbar.querySelector('.meta-user'))
  assert.ok(topbar.querySelector('.meta-countdown'))
  assert.equal(f.container.querySelector('.reader-feed'), null)
  assert.equal(editor.hidden, false)
  assert.equal(f.container.querySelector('.today-editor-shell'), editor)
})


test('Reader uses JW reading type, moderately wider insets and quiet rail controls; no author metadata inside cards', async t => {
  const f = await fixture(t); await f.mount()
  const archiveText = document.createElement('div'); archiveText.className = 'saved-text'; document.body.append(archiveText)
  try {
    const text = f.container.querySelector('.owner-publication-text')
    assert.equal(getComputedStyle(text).font, getComputedStyle(archiveText).font)
    const content = f.container.querySelector('.owner-publications-content')
    assert.equal(getComputedStyle(content).paddingInline, 'var(--reader-text-inset)')
    assert.equal(getComputedStyle(f.container.querySelector('.reader-feed')).getPropertyValue('--reader-text-inset'), '44px')
    assert.equal(f.container.querySelector('.reader-publication-author'), null)
    assert.equal(f.sidebar.querySelectorAll('.reader-publication-author').length, 5)
    assert.ok(f.sidebar.textContent.includes('Third'))
    assert.equal(getComputedStyle(f.sidebar.querySelector('.reader-publication-author')).fontSize, '16px')
    assert.equal(getComputedStyle(f.sidebar.querySelector('.owner-publication-metadata')).fontSize, '13px')
    assert.ok(f.sidebar.textContent.includes(f.publicProfiles[1].publicAlias))
    for (const button of f.container.querySelectorAll('h2 button')) {
      assert.equal(getComputedStyle(button).borderTopWidth, '0px')
      assert.equal(getComputedStyle(button).backgroundColor, 'rgba(0, 0, 0, 0)')
    }
    for (const button of f.sidebar.querySelectorAll('.reader-publication-author button')) {
      assert.equal(getComputedStyle(button).borderTopWidth, '0px')
      assert.equal(getComputedStyle(button).backgroundColor, 'rgba(0, 0, 0, 0)')
    }
    await click(button(f.sidebar, 'Снять с публикации'))
    assert.equal(getComputedStyle(button(f.sidebar, 'Отмена')).fontWeight, '600')
    assert.equal(button(f.sidebar, 'Снять с публикации')?.closest('.owner-publication-metadata') === f.sidebar.firstChild.firstChild, false)
    await click(button(f.sidebar, 'Отмена'))
  } finally { archiveText.remove() }
})


test('Reader metadata follows headerless and filtered viewport geometry without changing owner header layout', async t => {
  const f = await fixture(t); await f.mount()
  const scroller = f.container.querySelector('.owner-publications-scroll')
  scroller.getBoundingClientRect = () => ({ top: 100, bottom: 600 })
  f.sidebar.getBoundingClientRect = () => ({ top: 80 })
  const measure = () => scroller.dispatchEvent(new dom.window.Event('scroll'))
  measure()
  assert.equal(f.container.querySelector('h1'), null)
  assert.equal(f.sidebar.querySelector('.owner-publication-rail').style.top, '20px')
  await click(button(f.sidebar, 'Mumipol'))
  const header = f.container.querySelector('h1')
  header.getBoundingClientRect = () => ({ bottom: 168 })
  measure()
  assert.equal(getComputedStyle(header).fontSize, '16px')
  assert.equal(getComputedStyle(header).lineHeight, '20px')
  assert.equal(f.sidebar.querySelector('.owner-publication-rail').style.top, '96px')
  await click(f.container.querySelector('[aria-label="Сбросить фильтр автора"]'))
  measure()
  assert.equal(f.container.querySelector('h1'), null)
  assert.equal(f.sidebar.querySelector('.owner-publication-rail').style.top, '20px')
})


test('Reader footer derives refreshed result counts with Russian inflection without persisting anything', async t => {
  const f = await fixture(t)
  const before = await f.dump()
  const items = await f.api.list(f.users[0])
  await f.mount()
  for (const [count, noun] of [[11, 'текстов'], [21, 'текст'], [22, 'текста'], [25, 'текстов']]) {
    f.api.list = async () => Array.from({ length: count }, (_, index) => ({ ...items[index % items.length], publicationId: `fixture-refresh-${index}` }))
    await f.refresh()
    assert.equal(f.footer.textContent, `Опубликовано ${count} ${noun}`)
  }
  assert.deepEqual(await f.dump(), before)
})
