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

test('Studio opens Philosophy from its file, switches empty tabs and resets on re-entry', async () => {
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
    assert.equal(note.textContent, '© 2026 Just Writing · Сохранено и опубликовано')
    assert.equal(note.querySelector('strong em').textContent, 'Just Writing')
    assert.ok(container.querySelector('.bottom-bar .footer-center .footer-status-text') === note)
    assert.ok(!container.querySelector('.studio-content .studio-publication-note'))
    for (const label of ['White paper', 'Артефакт', 'План студии']) {
      await click(label)
      assert.equal(container.querySelector('nav [aria-current=page]').textContent, label)
      assert.equal(container.querySelector('.studio-content').textContent, '')
      assert.ok(!container.querySelector('.studio-publication-note'))
    }
    await click('←')
    assert.equal(container.querySelector('nav [aria-current=page]').textContent.trim(), 'Текст сегодня')
    await click('Студия')
    assert.equal(container.querySelector('nav [aria-current=page]').textContent, 'Философия')
  } finally { await act(async () => root.unmount()); container.remove() }
})
