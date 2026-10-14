import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const { default: MainNavigation } = await server.ssrLoadModule('/src/components/MainNavigation.jsx')
after(async () => { await server.close(); dom.window.close() })

test('main navigation orders the writing journey and routes each item with one active state', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), calls = []
  const ids = ['today', 'archive', 'publications', 'research', 'settings', 'studio']
  try {
    for (const section of ids) {
      await act(async () => root.render(createElement(MainNavigation, { section, onSelect: id => calls.push(id) })))
      assert.deepEqual([...host.querySelectorAll('button')].map(n => n.textContent), ['Текст сегодня', 'Архив и избранное', 'Опубликованные тексты', 'Исследования', 'Настройки', 'Студия'])
      assert.equal(host.querySelectorAll('[aria-current=page]').length, 1)
      await act(async () => host.querySelector('[aria-current=page]').click())
      assert.equal(calls.at(-1), section)
    }
  } finally { await act(async () => root.unmount()); host.remove() }
})

test('archive and publications have distinct children, group spacing, channel counts and guest permissions', async () => {
  const { default: LocalNavigation } = await server.ssrLoadModule('/src/components/MyTextsNavigation.jsx')
  const { StudioNavigation } = await server.ssrLoadModule('/src/Studio.jsx')
  const { default: ResearchNavigation } = await server.ssrLoadModule('/src/components/ResearchNavigation.jsx')
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), calls = []
  const props = { busy: false, onExit: () => calls.push('exit'), onSearchOpen: () => calls.push('search'), onSemanticOpen: value => calls.push(value), onPublicationChannel: value => calls.push(value), onOpenProfile: () => calls.push('guest'), onOpenFeed: () => calls.push('reader') }
  const labels = () => [...host.querySelectorAll('button')].map(node => node.querySelector('.owner-publication-channel-label')?.textContent ?? node.textContent)
  try {
    await act(async () => root.render(createElement(LocalNavigation, { ...props, navigationGroup: 'archive' })))
    assert.deepEqual(labels(), ['Поиск по архиву', 'Названия', 'Теги', 'Коллекция', '←'])
    assert.equal(host.querySelector('.navigation-group-start').textContent, 'Коллекция')
    assert.equal(host.querySelector('.navigation-group-start').disabled, true)
    for (const node of host.querySelectorAll('button:not(:disabled)')) await act(async () => node.click())
    assert.deepEqual(calls, ['search', 'title', 'tag', 'exit'])
    calls.length = 0
    for (const channel of ['profile', 'feed', 'internet']) {
      await act(async () => root.render(createElement(LocalNavigation, { ...props, navigationGroup: 'publications', publicationPage: channel, publicationCounts: { profile: 3, feed: 0, internet: 1 }, publicIdentity: { profileVisible: true } })))
      assert.deepEqual(labels(), ['Профиль', 'Лента', 'Интернет', 'Посмотреть профиль как гость', 'Общая страница', '←'])
      assert.deepEqual([...host.querySelectorAll('.owner-publication-count')].map(node => node.textContent), ['3', '0', '1'])
      assert.equal(host.querySelectorAll('[aria-current=page]').length, 1)
      await act(async () => host.querySelector('[aria-current=page]').click())
      assert.equal(calls.at(-1), channel)
    }
    await act(async () => root.render(createElement(LocalNavigation, { ...props, navigationGroup: 'publications', publicIdentity: { profileVisible: false } })))
    assert.equal(labels().includes('Посмотреть профиль как гость'), false)
    await act(async () => root.render(createElement(StudioNavigation, { view: 'artifact', onSelect: value => calls.push(value), onExit: props.onExit })))
    assert.deepEqual(labels(), ['Философия', 'White paper', 'План студии', 'Артефакты', 'Библиотека', '←'])
    assert.equal(host.querySelector('.navigation-group-start').textContent, 'Артефакты')
    assert.equal(host.querySelector('[aria-current=page]').textContent, 'Артефакты')
    await act(async () => root.render(createElement(ResearchNavigation, { view: 'meanings', onSelect: value => calls.push(value), onExit: props.onExit })))
    assert.deepEqual(labels(), ['Статистика', 'Смыслы', '←'])
    assert.equal(host.querySelector('[aria-current=page]').textContent, 'Смыслы')
  } finally { await act(async () => root.unmount()); host.remove() }
})
