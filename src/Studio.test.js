import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<body></body>', { url: 'https://studio.test', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'sessionStorage']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error',
  plugins: [{ name: 'studio-test-editor', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/hooks/useTodayText.js')) return `export const useTodayText = () => ({ userId: 'u', text: '', ready: false, status: 'saved', localProfile: {}, endWriting() {}, dayEndsAt: null })`
    if (id.endsWith('/src/components/WritingEditor.jsx')) return 'export default function WritingEditor() { return null }'
  } }] })
const { default: App } = await server.ssrLoadModule('/src/App.jsx')
after(async () => { await server.close(); dom.window.close() })

test('Studio reads section content files and resets to Philosophy on re-entry', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const click = async label => {
    const button = [...container.querySelectorAll('nav button')].find(node => node.textContent.trim() === label)
    assert.ok(button, label)
    await act(async () => button.click())
  }
  try {
    await act(async () => root.render(createElement(App)))
    await click('Студия')
    assert.equal(container.querySelector('nav [aria-current=page]').textContent, 'Философия')
    const source = readFileSync(new URL('./content/philosophy.md', import.meta.url), 'utf8')
    assert.deepEqual([...container.querySelectorAll('.studio-content p')].map(p => p.textContent), source.trim().split(/\n\s*\n/).map(p => p.replaceAll('**', '')))
    assert.equal(container.querySelectorAll('.studio-content p strong').length, 3)
    const note = container.querySelector('.studio-publication-note')
    const footer = container.querySelector('.bottom-bar')
    assert.equal(note.textContent, '© 2026 Just Writing · Сохранено и опубликовано')
    assert.equal(note.querySelector('strong em').textContent, 'Just Writing')
    assert.ok(container.querySelector('.bottom-bar .footer-center .footer-status-text') === note)
    assert.ok(!container.querySelector('.studio-content .studio-publication-note'))
    for (const [label, file] of [['White paper', 'white-paper.md'], ['Артефакты', 'artifact.md'], ['План студии', 'studio-plan.md']]) {
      await click(label)
      assert.equal(container.querySelector('nav [aria-current=page]').textContent, label)
      const content = readFileSync(new URL(`./content/${file}`, import.meta.url), 'utf8')
      assert.equal(container.querySelector('.bottom-bar'), footer, 'section content preserves the existing footer outside its scrolling article')
      assert.equal(container.querySelector('.studio-content').contains(footer), false)
      if (file === 'white-paper.md') {
        assert.equal(container.querySelector('.studio-content h1').textContent, 'Just Writing — White Paper')
        assert.deepEqual([...container.querySelectorAll('.studio-content h2')].map(node => node.textContent), [...content.matchAll(/^## (.+)$/gm)].map(match => match[1]))
        assert.equal(container.querySelector('.studio-content strong').textContent, 'первичен сам текст')
        assert.deepEqual([...container.querySelectorAll('.studio-content li')].map(node => node.textContent), [...content.matchAll(/^- (.+)$/gm)].map(match => match[1]))
        assert.ok(container.querySelector('.studio-content').textContent.trim().endsWith('Проект растёт от реальной практики письма: сначала появляется необходимость, затем функция.'))
      } else assert.deepEqual([...container.querySelectorAll('.studio-content p')].map(p => p.textContent), content.trim().split(/\n\s*\n/).filter(Boolean).map(p => p.replaceAll('**', '')))
      assert.ok(!container.querySelector('.studio-publication-note'))
    }
    await click('←')
    assert.equal(container.querySelector('nav [aria-current=page]').textContent.trim(), 'Текст сегодня')
    await click('Студия')
    assert.equal(container.querySelector('nav [aria-current=page]').textContent, 'Философия')
  } finally { await act(async () => root.unmount()); container.remove() }
})

test('Studio renders newly supplied Markdown for each section without adding product text to JSX', async () => {
  const fixtures = [
    { view: 'white-paper', file: 'white-paper.md' },
    { view: 'artifact', file: 'artifact.md' },
    { view: 'plan', file: 'studio-plan.md' },
  ]
  const markdown = '# Заголовок\n\n## Раздел\n\n**Жирный** и *курсив*.\n\n- Первый\n- **Второй** с `code *literal*`\n\nНовый абзац с **жирным и *курсивным*** текстом и \\*буквальной звёздочкой\\*.\n'
  const contentServer = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error',
    plugins: [{ name: 'studio-content-fixture', enforce: 'pre', transform(_code, id) {
      const fixture = fixtures.find(item => id.endsWith(`/src/content/${item.file}?raw`))
      if (fixture) return `export default ${JSON.stringify(markdown)}`
    } }] })
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    const { default: Studio } = await contentServer.ssrLoadModule('/src/Studio.jsx')
    for (const fixture of fixtures) {
      await act(async () => root.render(createElement(Studio, { view: fixture.view })))
      assert.equal(container.querySelector('h1').textContent, 'Заголовок')
      assert.equal(container.querySelector('h2').textContent, 'Раздел')
      assert.equal(container.querySelector('p strong').textContent, 'Жирный')
      assert.equal(container.querySelector('p em').textContent, 'курсив')
      assert.deepEqual([...container.querySelectorAll('ul li')].map(node => node.textContent), ['Первый', 'Второй с code *literal*'])
      assert.equal(container.querySelector('code').textContent, 'code *literal*')
      assert.equal(container.querySelector('p:last-child strong em').textContent, 'курсивным')
      assert.ok(container.querySelector('p:last-child').textContent.endsWith('*буквальной звёздочкой*.'))
      assert.equal(container.querySelectorAll('p').length, 2)
    }
  } finally { await act(async () => root.unmount()); container.remove(); await contentServer.close() }
})

test('Studio Markdown keeps empty sections empty and sanitizes HTML without losing supported formatting', async () => {
  const { default: StudioMarkdown } = await server.ssrLoadModule('/src/components/StudioMarkdown.jsx')
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(StudioMarkdown, { content: '', label: 'Пусто' })))
    assert.equal(container.querySelector('article').childElementCount, 0)
    await act(async () => root.render(createElement(StudioMarkdown, {
      content: '# Безопасный заголовок\n\n**Текст**\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[ссылка](javascript:alert(1))', label: 'Тест',
    })))
    assert.equal(container.querySelector('h1').textContent, 'Безопасный заголовок')
    assert.equal(container.querySelector('strong').textContent, 'Текст')
    assert.equal(container.querySelector('script, img, [onerror], [href^="javascript:"]'), null)
  } finally { await act(async () => root.unmount()); container.remove() }
})
