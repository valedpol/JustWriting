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
style.textContent = ['../index.css', '../App.css', '../MyTexts.css', './OwnerPublications.css', './ReaderFeed.css', './PublicProfileView.css']
  .map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n')
document.head.append(style)
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
globalThis.IDBKeyRange = IDBKeyRange
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', plugins: [{ name: 'reader-app-fixture', enforce: 'pre', transform(code, id) {
  if (id.endsWith('/src/storage/database.js')) return code.replace('export function transaction(storeNames, mode, run) {', 'export function transaction(storeNames, mode, run) { if (globalThis.__readerRunTransaction) return globalThis.__readerRunTransaction(storeNames, mode, run);')
  if (id.endsWith('/src/hooks/useTodayText.js')) return 'export const useTodayText = () => globalThis.__readerToday'
  if (id.endsWith('/src/components/PublicProfileView.jsx')) return code.replace('api = profileApi', 'api = globalThis.__readerProfileApi ?? profileApi')
  if (id.endsWith('/src/components/ReaderFeed.jsx')) return code.replace('api = readerApi', 'api = globalThis.__readerApi ?? readerApi')
} }] })
const { default: ReaderFeed } = await server.ssrLoadModule('/src/components/ReaderFeed.jsx')
after(async () => { delete globalThis.__readerRunTransaction; delete globalThis.__readerProfileApi; delete globalThis.__readerApi; delete globalThis.__readerToday; await server.close(); dom.window.close() })
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
  const container = document.createElement('div'), sidebar = document.createElement('aside'), footer = document.createElement('footer'), authorInfo = document.createElement('aside')
  document.body.append(container, sidebar, footer, authorInfo)
  const root = createRoot(container)
  const mount = async () => {
    await act(async () => root.render(createElement(ReaderFeed, { userId: data.users[0], metadataHost: sidebar, statusHost: footer, api: data.api })))
    await settle(() => container.querySelectorAll('article').length > 0)
  }
  const refresh = async () => { await act(async () => window.dispatchEvent(new dom.window.Event('focus'))); await act(async () => new Promise(resolve => setTimeout(resolve, 20))) }
  t.after(async () => { await act(async () => root.unmount()); container.remove(); sidebar.remove(); footer.remove(); authorInfo.remove(); db.close() })
  return { ...data, container, sidebar, footer, authorInfo, root, accessed, runTransaction, dump, mount, refresh,
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
  assert.equal(namedNote.querySelector('.reader-publication-author').textContent, '●Mumipol')
  assert.equal(f.sidebar.querySelectorAll('.reader-own-marker').length, 3)
  assert.equal(f.sidebar.textContent.includes('Моя публикация'), false)
  assert.equal(namedNote.querySelector('.reader-author-reveal'), null)
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
  assert.equal(own.querySelector('.reader-author-reveal'), null)
  assert.equal(own.querySelector('.reader-author-disclosed'), null)
  const originalList = f.api.list
  f.api.list = async userId => {
    const items = await originalList(userId)
    const foreignRecord = items.find(item => item.author?.displayName === 'Third')
    return [...items, { ...foreignRecord, publicationId: 'same-author-second-publication' }]
  }
  await f.refresh()
  const foreignNotes = [...f.sidebar.querySelectorAll('.owner-publication-metadata')].filter(note => note.querySelector('.reader-author-name')?.textContent === 'Third')
  assert.equal(foreignNotes.length, 2)
  const [foreign, sibling] = foreignNotes
  f.currentNames.set(f.users[2], 'Updated fixture name')
  await click(foreign.querySelector('.reader-author-reveal'))
  assert.equal(foreign.querySelector('.reader-author-disclosed').textContent, 'Updated fixture name')
  assert.equal(sibling.querySelector('.reader-author-disclosed'), null, 'reveal is local to one publication')
  assert.equal(foreign.querySelector('.reader-author-name').parentElement, foreign.querySelector('.reader-author-disclosed').parentElement)
  assert.notEqual(getComputedStyle(foreign.querySelector('.reader-author-disclosed')).flexBasis, '100%')
  await click(sibling.querySelector('.reader-author-reveal'))
  assert.equal(sibling.querySelector('.reader-author-disclosed').textContent, 'Updated fixture name')
  await click(foreign.querySelector('.reader-author-reveal'))
  assert.equal(foreign.querySelector('.reader-author-disclosed'), null)
  assert.equal(sibling.querySelector('.reader-author-disclosed').textContent, 'Updated fixture name')
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ ...f.publicProfiles[2], allowNameDisclosure: false }))
  await f.refresh()
  assert.equal(foreign.querySelector('.reader-author-reveal'), null)
  assert.equal(foreign.querySelector('.reader-author-disclosed'), null)
  assert.equal(sibling.querySelector('.reader-author-disclosed'), null)
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
  globalThis.__readerProfileApi = f.profileApi
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

test('Public Profile renders public live stats/details and immutable Profile cards for owner-as-guest without any owner actions', async t => {
  const f = await fixture(t)
  const { default: PublicProfileView } = await server.ssrLoadModule('/src/components/PublicProfileView.jsx')
  const publications = (await f.dump()).publications
  await f.runTransaction(['texts'], 'readwrite', tx => tx.objectStore('texts').put({ ...f.texts[0], content: 'CHANGED SOURCE', revision: 9 }))
  await act(async () => f.root.render(createElement(PublicProfileView, { publicId: f.publicProfiles[0].publicId, metadataHost: f.sidebar, authorInfoHost: f.authorInfo, api: f.profileApi })))
  await settle(() => f.container.querySelectorAll('article').length === 1)
  assert.ok(!f.container.querySelector('.public-profile-introduction'))
  assert.equal(f.authorInfo.querySelector('.public-profile-name').textContent, 'Current fixture name 0')
  assert.equal(f.authorInfo.querySelector('.public-profile-since').textContent.trim(), 'в проекте с 01.09.2026')
  assert.equal(f.authorInfo.querySelector('.public-profile-since').parentElement, f.authorInfo.querySelector('.public-profile-totals').parentElement, 'joinedAt and writing totals form one group')
  assert.ok(f.authorInfo.querySelector('.public-profile-totals').textContent.includes('1день письма'))
  assert.equal(f.authorInfo.querySelector('.public-profile-about').textContent, 'Пишу о новых мирах.')
  assert.equal(f.authorInfo.querySelector('.public-profile-service-heading').textContent, 'О себе')
  const link = f.authorInfo.querySelector('.public-profile-links a')
  assert.equal(link.textContent, 'Сайт ↗')
  assert.equal(link.tagName, 'A')
  assert.equal(link.href, 'https://example.org/')
  assert.equal(link.rel, 'noopener noreferrer')
  assert.equal(f.container.querySelector('article h2').textContent, 'Snapshot title')
  assert.equal(f.container.querySelector('h2 button').getAttribute('aria-expanded'), 'false')
  assert.equal(f.container.querySelector('.owner-publication-written').textContent, 'Написано 7 октября 2026')
  assert.equal(f.sidebar.querySelector('time').dateTime, new Date(200).toISOString())
  await click(f.container.querySelector('h2 button'))
  assert.equal(f.container.querySelector('.owner-publication-text').textContent, f.texts[0].content)
  for (const mark of ['strong', 'em', 'u']) assert.ok(f.container.querySelector(`.owner-publication-text ${mark}`))
  await click(f.container.querySelector('.owner-publication-text'))
  assert.equal(f.container.querySelector('h2 button').getAttribute('aria-expanded'), 'true')
  await click(f.container.querySelector('h2 button'))
  assert.equal(f.container.querySelector('h2 button').getAttribute('aria-expanded'), 'false')
  assert.equal(f.sidebar.querySelector('button'), null)
  for (const secret of ['●', 'Снять', 'PRIVATE TAG', 'CHANGED SOURCE', 'HISTORICAL NAME', ...f.users, ...f.texts.map(text => text.textId)]) assert.equal((f.container.textContent + f.sidebar.textContent).includes(secret), false)
  assert.deepEqual((await f.dump()).publications, publications)
})

test('Public Profile omits missing date/about/links/stats, renders fallback empty profile and respects profile/name revocation', async t => {
  const f = await fixture(t)
  const { default: PublicProfileView } = await server.ssrLoadModule('/src/components/PublicProfileView.jsx')
  const render = async index => act(async () => f.root.render(createElement(PublicProfileView, { key: index, publicId: f.publicProfiles[index].publicId, metadataHost: f.sidebar, authorInfoHost: f.authorInfo, api: f.profileApi })))
  await render(2)
  await settle(() => f.container.querySelectorAll('article').length === 1)
  assert.ok(!f.authorInfo.querySelector('.public-profile-since time'))
  assert.ok(!f.authorInfo.querySelector('.public-profile-since'))
  assert.equal(f.authorInfo.querySelector('.public-profile-name').textContent, 'Current fixture name 2')
  assert.ok(!f.authorInfo.querySelector('.public-profile-about'))
  assert.ok(!f.authorInfo.querySelector('.public-profile-about-block'))
  assert.ok(!f.authorInfo.querySelector('.public-profile-service-heading'))
  assert.ok(!f.authorInfo.querySelector('.public-profile-links'))
  assert.equal(f.container.querySelector('h2').textContent, 'Без названия')
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ ...f.publicProfiles[2], allowNameDisclosure: false }))
  f.stats.delete(f.publicProfiles[2].publicId)
  await f.refresh()
  assert.ok(!f.authorInfo.querySelector('.public-profile-since'))
  assert.ok(!f.authorInfo.querySelector('.public-profile-name'))
  assert.ok(!f.authorInfo.querySelector('.public-profile-totals'))
  assert.equal(f.container.querySelectorAll('article').length, 1)
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ ...f.publicProfiles[1], profileVisible: true }))
  await render(1)
  await settle(() => f.container.textContent.includes('Автор не готов делиться текстами.'))
  assert.equal(f.container.querySelectorAll('article').length, 0)
  assert.ok(f.authorInfo.querySelector('.public-profile-since').textContent.includes('в проекте с'))
  assert.equal(f.container.textContent.includes('Current fixture name 1'), false)
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ ...f.publicProfiles[1], profileVisible: false }))
  await f.refresh()
  assert.ok(!f.authorInfo.querySelector('.public-profile-introduction'))
  assert.ok(f.container.textContent.includes('Профиль недоступен.'))
})

test('Public Profile renders exactly one pinned compact snapshot first, preserves preview/expansion and drops the label after unpinning', async t => {
  const f = await fixture(t)
  const older = (await f.repo.listOwnPublications(f.users[0], 'profile'))[0]
  const fragment = f.records.find(record => record.userId === f.users[0] && record.channel === 'feed' && record.snapshot.title === undefined)
  await f.repo.createPublications(f.users[0], { source: fragment.source, channels: ['profile'] })
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', older.publicationId)
  const { default: PublicProfileView } = await server.ssrLoadModule('/src/components/PublicProfileView.jsx')
  await act(async () => f.root.render(createElement(PublicProfileView, { publicId: f.publicProfiles[0].publicId, metadataHost: f.sidebar, authorInfoHost: f.authorInfo, api: f.profileApi })))
  await settle(() => f.container.querySelectorAll('article').length === 2)
  const first = f.container.querySelector('article')
  assert.equal(first.querySelector('h2 button').textContent, 'Snapshot title')
  assert.equal(first.querySelector('.public-profile-pinned').textContent, 'Закреплено')
  assert.equal(first.querySelector('.public-profile-pinned').parentElement, first.querySelector('h2'))
  assert.equal(getComputedStyle(first.querySelector('h2')).display, 'flex')
  assert.equal(getComputedStyle(first.querySelector('.public-profile-pinned')).flexShrink, '0')
  assert.equal(f.container.querySelectorAll('.public-profile-pinned').length, 1)
  assert.equal(first.querySelector('h2 button').getAttribute('aria-expanded'), 'false')
  assert.equal(first.querySelector('.owner-publication-preview').textContent, older.snapshot.content)
  assert.equal(f.container.querySelectorAll('.owner-publication-preview').length, 2)
  assert.equal(getComputedStyle(first.querySelector('.owner-publication-preview-wrap')).fontSize, '16px')
  await click(first.querySelector('h2 button'))
  assert.equal(first.querySelector('.owner-publication-text').textContent, older.snapshot.content)
  for (const mark of ['strong', 'em', 'u']) assert.ok(first.querySelector(`.owner-publication-text ${mark}`))
  assert.equal(getComputedStyle(first.querySelector('.owner-publication-text')).fontSize, '20px', 'full reading typography remains unchanged')
  await click(first.querySelector('h2 button'))
  assert.ok(first.querySelector('.owner-publication-preview'))
  assert.ok(!f.sidebar.querySelector('button'))
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', null)
  await f.refresh()
  assert.ok(!f.container.querySelector('.public-profile-pinned'))
  assert.equal(f.container.querySelector('article h2').textContent, 'Без названия')
})

test('Public Profile footer derives active Profile counts with Russian inflection, refreshes and never saves the summary', async t => {
  const f = await fixture(t)
  const { default: PublicProfileView } = await server.ssrLoadModule('/src/components/PublicProfileView.jsx')
  const profile = await f.profileApi.load(f.publicProfiles[0].publicId)
  let count = 1, unavailable = false
  const api = { load: async () => unavailable ? null : { ...profile, publications: Array.from({ length: count }, (_, i) => ({ ...profile.publications[0], publicationId: `footer-fixture-${i}` })) } }
  const before = await f.dump()
  await act(async () => f.root.render(createElement(PublicProfileView, { publicId: profile.publicId, metadataHost: f.sidebar, statusHost: f.footer, authorInfoHost: f.authorInfo, api })))
  await settle(() => f.footer.textContent === 'Опубликовано 1 текст')
  for (const [next, noun] of [[0, 'текстов'], [2, 'текста'], [4, 'текста'], [5, 'текстов'], [11, 'текстов'], [21, 'текст'], [22, 'текста']]) {
    count = next; await f.refresh()
    assert.equal(f.footer.textContent, `Опубликовано ${next} ${noun}`)
    assert.equal(f.container.querySelectorAll('article').length, next)
  }
  unavailable = true; await f.refresh()
  assert.equal(f.footer.textContent, '')
  assert.deepEqual(await f.dump(), before)
})

test('Public Profile pin stays first across newer publications, scroll, refresh/remount/reopen, replacement, unpin and deletion', async t => {
  const f = await fixture(t)
  const { default: PublicProfileView } = await server.ssrLoadModule('/src/components/PublicProfileView.jsx')
  const { createPublicationRepository } = await import('../storage/publicationRepository.js')
  const id = f.publicProfiles[0].publicId
  const older = (await f.repo.listOwnPublications(f.users[0], 'profile'))[0]
  const fragments = f.records.filter(row => row.userId === f.users[0] && row.channel === 'feed' && row.snapshot.title === undefined)
  const [middle] = await f.repo.createPublications(f.users[0], { source: fragments[0].source, channels: ['profile'] })
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', older.publicationId)
  const render = async () => act(async () => f.root.render(createElement(PublicProfileView, { publicId: id, metadataHost: f.sidebar, authorInfoHost: f.authorInfo, api: f.profileApi })))
  const contents = () => [...f.container.querySelectorAll('.owner-publication-preview')].map(node => node.textContent)
  await render(); await settle(() => contents().length === 2)
  assert.deepEqual(contents(), [older.snapshot.content, middle.snapshot.content])
  const laterRepo = createPublicationRepository({ runTransaction: f.runTransaction, flush: async () => {}, now: () => 1000 })
  const [newest] = await laterRepo.createPublications(f.users[0], { source: fragments[1].source, channels: ['profile'] })
  await f.refresh()
  assert.deepEqual(contents(), [older.snapshot.content, newest.snapshot.content, middle.snapshot.content], 'publishedAt cannot displace the pin')
  const scroller = f.container.querySelector('.archive-scroll')
  await act(async () => { scroller.scrollTop = 77; scroller.dispatchEvent(new dom.window.Event('scroll')) })
  assert.deepEqual(contents(), [older.snapshot.content, newest.snapshot.content, middle.snapshot.content])
  assert.equal(getComputedStyle(f.container.querySelector('article')).position, 'sticky')
  assert.equal(getComputedStyle(f.container.querySelector('article')).top, '0px')
  assert.equal(f.container.querySelectorAll('.is-profile-pinned').length, 1)
  await f.reopen(); await act(async () => f.root.render(null)); await render()
  await settle(() => contents().length === 3)
  assert.deepEqual(contents(), [older.snapshot.content, newest.snapshot.content, middle.snapshot.content])
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', middle.publicationId)
  await f.refresh()
  assert.deepEqual(contents(), [middle.snapshot.content, newest.snapshot.content, older.snapshot.content])
  assert.equal(f.container.querySelectorAll('.is-profile-pinned').length, 1)
  assert.equal(getComputedStyle(f.container.querySelector('article')).position, 'sticky')
  const placeholder = f.container.querySelector('article h2')
  assert.ok(placeholder.classList.contains('is-placeholder'))
  assert.equal(placeholder.querySelector('button').textContent, 'Без названия')
  assert.equal(placeholder.querySelector('.public-profile-pinned').textContent, 'Закреплено')
  assert.equal(f.container.querySelectorAll('.public-profile-pinned').length, 1)
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', null)
  await f.refresh()
  assert.deepEqual(contents(), [newest.snapshot.content, middle.snapshot.content, older.snapshot.content])
  assert.ok(!f.container.querySelector('.public-profile-pinned'))
  assert.ok(!f.container.querySelector('.is-profile-pinned'))
  assert.notEqual(getComputedStyle(f.container.querySelector('article')).position, 'sticky')
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', middle.publicationId)
  await f.repo.deletePublication(f.users[0], middle.publicationId)
  await f.refresh()
  assert.deepEqual(contents(), [newest.snapshot.content, older.snapshot.content])
  assert.ok(!f.container.querySelector('.public-profile-pinned'))
  assert.ok(!f.container.querySelector('.is-profile-pinned'))
  assert.equal((await f.dump()).settings.find(row => row.publicId === id).pinnedPublicationId, null)
  assert.deepEqual((await f.repo.listOwnPublications(f.users[0], 'profile')).find(row => row.publicationId === older.publicationId).snapshot, older.snapshot)
})

test('long Public Profile card renders two compact rows with B/I/U, expands the whole snapshot and collapses back without source reads', async t => {
  const f = await fixture(t)
  const { default: PublicProfileView } = await server.ssrLoadModule('/src/components/PublicProfileView.jsx')
  const profile = await f.profileApi.load(f.publicProfiles[0].publicId)
  const rows = Array.from({ length: 8 }, (_, i) => `row${i}`)
  const snapshot = { ...profile.publications[0].snapshot, content: rows.join('\n'), document: { type: 'doc', content: rows.map(text => ({ type: 'paragraph', content: [
    { type: 'text', text, marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }] },
  ] })) } }
  const original = structuredClone(snapshot), before = await f.dump()
  const api = { load: async () => ({ ...profile, publications: [{ ...profile.publications[0], snapshot }] }) }
  const rangePrototype = dom.window.Range.prototype
  const previousRects = rangePrototype.getClientRects, previousBounds = rangePrototype.getBoundingClientRect
  const rect = node => {
    const paragraph = node.nodeType === 3 ? node.parentElement.closest('p') : node.closest?.('p')
    const index = Number(paragraph?.textContent.match(/row(\d)/)?.[1] ?? 0)
    return { top: index * 24, bottom: index * 24 + 24, height: 24 }
  }
  rangePrototype.getClientRects = function () { return [rect(this.startContainer)] }
  rangePrototype.getBoundingClientRect = function () { return rect(this.startContainer) }
  try {
    f.accessed.length = 0
    await act(async () => f.root.render(createElement(PublicProfileView, { publicId: profile.publicId, metadataHost: f.sidebar, authorInfoHost: f.authorInfo, api })))
    await settle(() => f.container.querySelector('.owner-publication-preview'))
    const preview = () => f.container.querySelector('.owner-publication-preview')
    assert.equal(preview().textContent, 'row0row1…')
    assert.equal(preview().querySelectorAll('p').length, 2)
    for (const mark of ['strong', 'em', 'u']) assert.ok(preview().querySelector(mark))
    assert.ok(!f.container.querySelector('.owner-publication-preview-wrap .owner-publication-ellipsis + div'), 'no tail excerpt')
    assert.equal(f.container.querySelector('article h2').textContent, 'Snapshot title')
    assert.equal(f.container.querySelector('.owner-publication-written').textContent, 'Написано 7 октября 2026')
    assert.equal(f.sidebar.querySelector('time').dateTime, new Date(200).toISOString())
    await click(f.container.querySelector('article h2 button'))
    assert.ok(!preview())
    assert.equal(f.container.querySelector('.owner-publication-text').textContent, rows.join(''))
    assert.equal(f.container.querySelector('.owner-publication-text').querySelectorAll('p').length, 8)
    await click(f.container.querySelector('.owner-publication-text'))
    assert.equal(f.container.querySelector('article h2 button').getAttribute('aria-expanded'), 'true', 'reading text never collapses it')
    await click(f.container.querySelector('article h2 button'))
    assert.equal(preview().textContent, 'row0row1…')
    assert.deepEqual(snapshot, original)
    assert.equal(f.accessed.length, 0, 'renderer does not read or write source/storage')
    assert.deepEqual(await f.dump(), before)
  } finally {
    rangePrototype.getClientRects = previousRects; rangePrototype.getBoundingClientRect = previousBounds
  }
})

test('Public Profile disables native overscroll on the actual sticky scroller without changing Feed or driving card positions in JS', async t => {
  const f = await fixture(t)
  await f.mount()
  assert.equal(getComputedStyle(f.container.querySelector('.archive-scroll')).getPropertyValue('overscroll-behavior-y'), 'contain', 'Feed keeps its existing scroll behavior')
  const pin = (await f.repo.listOwnPublications(f.users[0], 'profile'))[0]
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', pin.publicationId)
  const { default: PublicProfileView } = await server.ssrLoadModule('/src/components/PublicProfileView.jsx')
  await act(async () => f.root.render(createElement(PublicProfileView, { publicId: f.publicProfiles[0].publicId, metadataHost: f.sidebar, api: f.profileApi })))
  await settle(() => f.container.querySelector('.is-profile-pinned'))
  const scroller = f.container.querySelector('.archive-scroll'), pinCard = f.container.querySelector('.is-profile-pinned')
  const assertNativeSticky = () => {
    assert.equal(getComputedStyle(scroller).overflowY, 'auto')
    assert.equal(getComputedStyle(scroller).getPropertyValue('overscroll-behavior-y'), 'none')
    assert.equal(pinCard.parentElement.className, 'owner-publications-content', 'the containing block is the full publication list')
    assert.equal(pinCard.parentElement.parentElement, scroller, 'no intermediate overflow container separates the pin from scrolling')
    assert.equal(getComputedStyle(pinCard).position, 'sticky')
    assert.equal(getComputedStyle(pinCard).top, '0px')
    for (const name of ['top', 'position', 'transform', 'translate']) assert.equal(pinCard.style.getPropertyValue(name), '', 'scroll events must not reposition the card in JS')
  }
  const before = await f.dump()
  // JSDOM has no native scroll compositor. These assertions cover the native
  // configuration and handler invariants; trackpad bounce needs browser acceptance.
  for (const expanded of [false, true, false]) {
    if (pinCard.querySelector('button').getAttribute('aria-expanded') !== String(expanded)) await click(pinCard.querySelector('button'))
    for (const offset of [0, 5000, 25, 10000, 0]) {
      await act(async () => { scroller.scrollTop = offset; scroller.dispatchEvent(new dom.window.Event('scroll')) })
      assertNativeSticky()
    }
  }
  assert.deepEqual(await f.dump(), before, 'scroll and expansion never write profile or snapshot data')
})

test('Public Profile marginal dates follow the sticky pin and stay clear of its occupied region during scroll', async t => {
  const f = await fixture(t)
  const older = (await f.repo.listOwnPublications(f.users[0], 'profile'))[0]
  for (const record of f.records.filter(row => row.userId === f.users[0] && row.channel === 'feed' && row.snapshot.title === undefined)) {
    await f.repo.createPublications(f.users[0], { source: record.source, channels: ['profile'] })
  }
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', older.publicationId)
  const { default: PublicProfileView } = await server.ssrLoadModule('/src/components/PublicProfileView.jsx')
  await act(async () => f.root.render(createElement(PublicProfileView, { publicId: f.publicProfiles[0].publicId, metadataHost: f.sidebar, api: f.profileApi })))
  await settle(() => f.container.querySelectorAll('article').length === 3)
  const scroller = f.container.querySelector('.archive-scroll')
  const articles = [...f.container.querySelectorAll('article')], notes = [...f.sidebar.querySelectorAll('.owner-publication-metadata')]
  scroller.getBoundingClientRect = f.sidebar.getBoundingClientRect = () => ({ top: 100, bottom: 600, height: 500 })
  articles.forEach((article, index) => {
    article.getBoundingClientRect = () => {
      const naturalTop = 128 + index * 152 - scroller.scrollTop
      const top = article.classList.contains('is-profile-pinned') ? Math.max(100, naturalTop) : naturalTop
      return { top, bottom: top + 120, height: 120 }
    }
    article.querySelector('h2').getBoundingClientRect = () => ({ top: article.getBoundingClientRect().top })
    notes[index].getBoundingClientRect = () => ({ height: 20 })
  })
  const scroll = async value => act(async () => { scroller.scrollTop = value; scroller.dispatchEvent(new dom.window.Event('scroll')) })
  await scroll(0)
  assert.equal(notes[0].style.top, '28px')
  assert.ok(notes.every(note => note.style.visibility !== 'hidden'))
  await scroll(200)
  assert.equal(notes[0].style.top, '0px', 'pinned date follows the pinned title')
  assert.equal(notes[1].style.visibility, 'hidden', 'date of a card scrolling behind the pin is concealed')
  assert.notEqual(notes[2].style.visibility, 'hidden')
  assert.ok(parseFloat(notes[2].style.top) >= articles[0].getBoundingClientRect().bottom + 8 - 100)
  await scroll(0)
  assert.equal(notes[0].style.top, '28px')
  assert.ok(notes.every(note => note.style.visibility !== 'hidden'))
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'pinnedPublicationId', null)
  await f.refresh(); await scroll(200)
  assert.ok(!f.container.querySelector('.is-profile-pinned'))
  assert.ok(notes.every(note => note.style.visibility !== 'hidden'), 'unpin clears metadata restrictions too')
})

async function mountArchiveApp(f, t) {
  globalThis.__readerRunTransaction = f.runTransaction
  globalThis.__readerApi = f.api; globalThis.__readerProfileApi = f.profileApi
  globalThis.__readerToday = { userId: f.users[0], localProfile: f.profiles[0], text: '', status: 'saved', ready: true,
    flush: async () => {}, endWriting() {}, updateSetting() {}, dayEndsAt: Date.now() + 100000, graceUntil: null }
  t.after(() => { delete globalThis.__readerRunTransaction })
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  await act(async () => f.root.render(createElement(App)))
  await click(button(f.container, 'Мои тексты'))
  await settle(() => f.container.querySelector('[data-text-id]'))
}

test('My Texts opens the same guest Public Profile by publicId and returns to its retained calendar, expanded editor and scroll; nickname and alias stay live', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const before = await f.dump()
  await mountArchiveApp(f, t)
  const navigation = () => f.container.querySelector('nav[aria-label="Мои тексты"]')
  await settle(() => button(navigation(), 'Профиль'))
  assert.deepEqual([...navigation().querySelectorAll('button')].map(node => node.textContent), ['Поиск', 'Названия', 'Теги', 'Публикации', 'Профиль', '←'])
  const archive = f.container.querySelector('.my-texts'), scroller = archive.querySelector('.archive-scroll')
  await click(archive.querySelector('[aria-controls="archive-calendar"]'))
  await click(button(archive.querySelector('[aria-label="Годы"]'), '2026'))
  await settle(() => !navigation().querySelector('button').disabled)
  await click(archive.querySelector('.archive-preview-button'))
  const editor = archive.querySelector('.ProseMirror')
  assert.ok(editor)
  scroller.scrollTop = 127
  const criterion = archive.querySelector('.archive-period').textContent
  const projected = await f.profileApi.load(f.publicProfiles[0].publicId)
  await click(button(navigation(), 'Профиль'))
  await settle(() => f.container.querySelector('.public-profile-view article'))
  assert.equal(archive.hidden, true)
  assert.equal(f.container.querySelector('.reader-feed-content'), null, 'direct entry does not mount Reader Feed')
  assert.equal(f.container.querySelector('.public-page-title').textContent, 'Профиль Mumipol')
  assert.equal(f.container.querySelector('.bottom-bar').textContent.trim(), 'Опубликовано 1 текст')
  const profileNavigation = f.container.querySelector('nav[aria-label="Публичный профиль"]')
  assert.equal(profileNavigation.textContent, '←')
  assert.ok(!profileNavigation.querySelector('.is-active'))
  const right = f.container.querySelector('.right-sidebar')
  assert.equal(right.querySelector('button'), null, 'there are no owner, archive or selection controls in the guest profile')
  const profileScroller = f.container.querySelector('.public-profile-view .archive-scroll')
  profileScroller.scrollTop = 0
  const metadataWheel = new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 })
  right.querySelector('time').dispatchEvent(metadataWheel)
  assert.equal(metadataWheel.defaultPrevented, true)
  assert.equal(profileScroller.scrollTop, 40)
  assert.equal(scroller.scrollTop, 127, 'profile wheel must not scroll the retained hidden archive')
  assert.equal(f.container.querySelector('.public-profile-view h2 button').textContent, projected.publications[0].snapshot.title)
  const { default: PublicProfileView } = await server.ssrLoadModule('/src/components/PublicProfileView.jsx')
  const guestContainer = document.createElement('div'), guestInfo = document.createElement('aside'), guestMetadata = document.createElement('aside')
  document.body.append(guestContainer, guestInfo, guestMetadata)
  const guestRoot = createRoot(guestContainer)
  try {
    await act(async () => guestRoot.render(createElement(PublicProfileView, { publicId: projected.publicId, metadataHost: guestMetadata, authorInfoHost: guestInfo, api: f.profileApi })))
    await settle(() => guestContainer.querySelector('article'))
    assert.equal(f.container.querySelector('.public-profile-view article').innerHTML, guestContainer.querySelector('article').innerHTML, 'the direct owner route renders the identical guest snapshot')
    assert.equal(f.container.querySelector('.public-profile-introduction').innerHTML, guestInfo.querySelector('.public-profile-introduction').innerHTML)
  } finally { await act(async () => guestRoot.unmount()); guestContainer.remove(); guestInfo.remove(); guestMetadata.remove() }
  await click(f.container.querySelector('[aria-label="Вернуться в Мои тексты"]'))
  assert.equal(f.container.querySelector('.public-profile-view'), null)
  assert.equal(f.container.querySelector('.my-texts'), archive)
  assert.equal(archive.hidden, false)
  assert.equal(archive.querySelector('.ProseMirror'), editor)
  assert.equal(archive.querySelector('.archive-period').textContent, criterion)
  assert.equal(scroller.scrollTop, 127)
  assert.equal(f.container.querySelector('.bottom-bar').textContent.trim(), 'Написано4 слов')
  assert.deepEqual(await f.dump(), before, 'navigation does not write settings, source or publications')
  await f.identityRepo.savePublicNickname(f.users[0], 'New nickname'); await f.refresh()
  await click(button(navigation(), 'Профиль'))
  await settle(() => f.container.querySelector('.public-page-title')?.textContent === 'Профиль New nickname')
  await f.identityRepo.savePublicNickname(f.users[0], ''); await f.refresh()
  await settle(() => f.container.querySelector('.public-page-title')?.textContent === `Профиль ${f.publicProfiles[0].publicAlias}`)
  await click(f.container.querySelector('[aria-label="Вернуться в Мои тексты"]'))
  await click(button(navigation(), 'Профиль'))
  await settle(() => f.container.querySelector('.public-profile-view article'))
  assert.equal(f.container.querySelector('.public-page-title').textContent, `Профиль ${f.publicProfiles[0].publicAlias}`)
  assert.deepEqual((await f.dump()).publications, before.publications, 'nickname changes never rewrite snapshots')
  await click(f.container.querySelector('[aria-label="Вернуться в Мои тексты"]'))
  await click(button(navigation(), 'Публикации'))
  await settle(() => f.container.querySelector('[aria-label="Публикации: Профиль"] article'))
  assert.ok(button(right, 'Снять с публикации'), 'owner Profile library remains a separate route')
  assert.ok(button(right, 'Закрепить в профиле'))
  await click(button(navigation(), '←'))
  await click(button(navigation(), '←'))
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'profileVisible', false)
  await click(button(f.container, 'Мои тексты')); await f.refresh()
  assert.equal(button(navigation(), 'Профиль'), undefined, 're-entry reads the current permission after leaving the archive')
})

test('My Texts omits the profile entry when visibility is false or absent and does not initialize missing identity', async t => {
  for (const permission of [false, undefined]) {
    const f = await fixture(t)
    await f.runTransaction(['settings'], 'readwrite', tx => {
      if (permission === undefined) tx.objectStore('settings').delete(`publicProfile:${f.users[0]}`)
      else tx.objectStore('settings').put({ ...f.publicProfiles[0], profileVisible: permission })
    })
    const before = await f.dump()
    await mountArchiveApp(f, t); await f.refresh()
    const navigation = f.container.querySelector('nav[aria-label="Мои тексты"]')
    assert.equal(button(navigation, 'Профиль'), undefined)
    assert.ok(button(navigation, 'Публикации'))
    assert.equal(f.container.querySelector('.public-profile-view'), null)
    assert.deepEqual(await f.dump(), before)
    await act(async () => f.root.render(null))
  }
})

test('Feed profile entry uses stable publicId and independent visibility, public header/back preserve author filter, expanded card and scroll', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  globalThis.__readerApi = f.api; globalThis.__readerProfileApi = f.profileApi
  globalThis.__readerToday = { userId: f.users[0], localProfile: f.profiles[0], text: '', status: 'saved', ready: true,
    flush: async () => {}, endWriting() {}, updateSetting() {}, dayEndsAt: Date.now() + 100000, graceUntil: null }
  const { default: App } = await server.ssrLoadModule('/src/App.jsx')
  await act(async () => f.root.render(createElement(App)))
  await click(button(f.container, 'Общая страница'))
  await settle(() => f.container.querySelectorAll('.reader-feed article').length === 5)
  const sidebar = f.container.querySelector('.right-sidebar')
  const note = name => [...sidebar.querySelectorAll('.owner-publication-metadata')].find(node => node.querySelector('.reader-author-name')?.textContent === name)
  assert.equal(sidebar.querySelector('.owner-publication-metadata').querySelector('.reader-profile-link'), null, 'anonymous publication has no profile link')
  assert.equal(note(f.publicProfiles[1].publicAlias).querySelector('.reader-profile-link'), null)
  assert.ok(note('Mumipol').querySelector('.reader-profile-link'))
  assert.equal(note('Mumipol').querySelector('.reader-author-reveal'), null)
  assert.ok(note('Third').querySelector('.reader-profile-link'))
  await click(button(sidebar, 'Mumipol'))
  const scroller = f.container.querySelector('.reader-feed-content .archive-scroll')
  const card = scroller.querySelector('article')
  await click(card.querySelector('h2 button'))
  scroller.scrollTop = 127
  await click(note('Mumipol').querySelector('.reader-profile-link'))
  await settle(() => f.container.querySelectorAll('.public-profile-view article').length === 1)
  assert.equal(f.container.querySelector('.public-page-title').textContent, 'Профиль Mumipol')
  assert.equal(f.container.querySelector('.bottom-bar').textContent.trim(), 'Опубликовано 1 текст', 'profile count excludes Feed/Internet snapshots')
  assert.ok(f.container.querySelector('.left-sidebar .public-profile-since'))
  assert.ok(f.container.querySelector('.left-sidebar .public-profile-about'))
  assert.equal(getComputedStyle(f.container.querySelector('.public-profile-author-slot')).paddingTop, '96px')
  assert.equal(getComputedStyle(f.container.querySelector('.public-profile-since')).fontSize, '18px')
  const nameStyle = getComputedStyle(f.container.querySelector('.public-profile-name')), brandStyle = getComputedStyle(f.container.querySelector('.brand-block'))
  for (const property of ['fontFamily', 'fontStyle', 'fontWeight']) assert.equal(nameStyle[property], brandStyle[property])
  assert.equal(nameStyle.fontSize, '18px')
  assert.equal(parseFloat(getComputedStyle(f.container.querySelector('.public-profile-links a > span')).fontSize),
    parseFloat(getComputedStyle(f.container.querySelector('.public-profile-links a')).fontSize) * .75)
  assert.equal(getComputedStyle(f.container.querySelector('.public-profile-totals strong')).fontSize, '22px')
  assert.equal(getComputedStyle(f.container.querySelector('.public-profile-about')).fontSize, '14px')
  assert.ok(!f.container.querySelector('.left-sidebar .quote-box'))
  assert.ok(!f.container.querySelector('.editor-column .public-profile-introduction'))
  const profileNavigation = f.container.querySelector('nav[aria-label="Публичный профиль"]')
  assert.equal(profileNavigation.textContent, '←')
  assert.equal(profileNavigation.querySelectorAll('.menu-item').length, 1)
  assert.ok(!profileNavigation.querySelector('.is-active'))
  assert.equal(f.container.querySelector('.topbar .meta-user'), null)
  assert.equal(f.container.querySelector('.topbar .meta-countdown'), null)
  assert.ok(f.container.querySelector('.reader-feed-content').hidden)
  assert.equal(sidebar.querySelector('button'), null, 'owner-as-guest has no owner controls')
  const profileScroll = f.container.querySelector('.public-profile-view .archive-scroll')
  profileScroll.scrollTop = 0
  const metadataWheel = new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 })
  sidebar.querySelector('time').dispatchEvent(metadataWheel)
  assert.equal(metadataWheel.defaultPrevented, true)
  assert.equal(profileScroll.scrollTop, 40)
  assert.equal(scroller.scrollTop, 127, 'profile wheel must not move the hidden Feed')
  const contentWheel = new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 })
  profileScroll.querySelector('article').dispatchEvent(contentWheel)
  assert.equal(contentWheel.defaultPrevented, false, 'native content scrolling remains native')
  await f.identityRepo.savePublicNickname(f.users[0], 'Polevoy')
  await f.refresh()
  assert.equal(f.container.querySelector('.public-page-title').textContent, 'Профиль Polevoy')
  await click(f.container.querySelector('[aria-label="Вернуться в Общую страницу"]'))
  assert.equal(f.container.querySelector('.public-profile-view'), null)
  assert.equal(f.container.querySelector('.public-page-title').textContent, 'Общая страница')
  assert.ok(!f.container.querySelector('nav[aria-label="Главное меню"]').textContent.includes('Профиль'))
  assert.equal(f.container.querySelector('.reader-feed h1').textContent, 'Polevoy×')
  assert.equal(f.container.querySelector('.reader-feed-content .archive-scroll'), scroller)
  assert.equal(scroller.scrollTop, 127)
  assert.equal(card.querySelector('h2 button').getAttribute('aria-expanded'), 'true')
  assert.equal(f.container.querySelector('.bottom-bar').textContent.trim(), 'Опубликовано 2 текста')
  await f.identityRepo.savePublicIdentitySetting(f.users[0], 'profileVisible', false)
  await f.refresh()
  assert.equal(note('Polevoy').querySelector('.reader-profile-link'), null, 'closed owner profile is not offered to its owner')
  await click(f.container.querySelector('[aria-label="Сбросить фильтр автора"]'))
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ ...f.publicProfiles[2], allowNameDisclosure: false }))
  await f.refresh()
  assert.equal(note('Third').querySelector('.reader-author-reveal'), null)
  assert.ok(note('Third').querySelector('.reader-profile-link'), 'profile permission does not depend on name disclosure')
  await click(note('Third').querySelector('.reader-profile-link'))
  await settle(() => f.container.querySelectorAll('.public-profile-view article').length === 1)
  assert.equal(f.container.querySelector('.public-page-title').textContent, 'Профиль Third')
  assert.equal(f.container.querySelector('.public-profile-since'), null)
  assert.equal(sidebar.querySelector('button'), null)
  await click(f.container.querySelector('[aria-label="Вернуться в Общую страницу"]'))
  await f.runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ ...f.publicProfiles[1], profileVisible: true }))
  await f.refresh()
  await click(note(f.publicProfiles[1].publicAlias).querySelector('.reader-profile-link'))
  await settle(() => f.container.textContent.includes('Автор не готов делиться текстами.'))
  assert.equal(f.container.querySelector('.public-page-title').textContent, `Профиль ${f.publicProfiles[1].publicAlias}`)
  assert.equal(f.container.querySelector('.bottom-bar').textContent.trim(), 'Опубликовано 0 текстов')
  assert.equal(sidebar.querySelector('button'), null)

})
