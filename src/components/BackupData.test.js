import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { createLastVerifiedBackupStore } from '../backup/lastVerifiedBackup.js'
import { renderToStaticMarkup } from 'react-dom/server'

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true, url: 'https://backup.test' })
for (const key of ['window', 'document', 'HTMLElement']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' })
const { default: BackupData } = await server.ssrLoadModule('/src/components/BackupData.jsx')
after(async () => { await server.close(); dom.window.close() })

async function fixture({ createFailure, verifyFailure, storage = new Map(), gate, capturedAt, texts } = {}) {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container), calls = [], active = []
  let phase = 'normal'
  const receipt = { capturedAt: 1791024689088, byteSize: 100, sha256: 'abc', origin: 'https://backup.test', dbVersion: 4,
    counts: { settings: 2, texts: 33, userDays: 33, wordCountSamples: 169 },
    restoreVerified: true, isolatedRestoreDeleted: true, isolatedRestoreName: 'just-writing-backup-verification-test' }
  if (capturedAt !== undefined) receipt.capturedAt = capturedAt
  if (texts !== undefined) receipt.counts.texts = texts
  const service = {
    status: () => ({ localPhase: phase }),
    async create(check) { calls.push('create'); check?.(); phase = 'maintenance'; if (createFailure) { phase = 'failed'; throw new Error(createFailure) }; return { file: new Blob(['backup']), receipt } },
    async verify(file, expected) { calls.push({ file: file.name, receipt: expected }); if (verifyFailure) throw new Error(verifyFailure); if (gate) await gate; phase = 'normal'; return { ...receipt, filename: file.name } },
    async resume() { calls.push('resume'); phase = 'normal' },
  }
  await act(async () => root.render(createElement(BackupData, { service, metadataStore: createLastVerifiedBackupStore({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }), download: () => { calls.push('download'); return { url: 'blob:test' } }, onActiveChange: value => active.push(value) })))
  return { container, calls, active, storage,
    click: async label => act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === label).click()),
    async select(name) {
      const input = container.querySelector('input[type=file]')
      Object.defineProperty(input, 'files', { configurable: true, value: [new File(['backup'], name)] })
      await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    },
    async close() { await act(async () => root.unmount()); container.remove() },
  }
}

test('download is unverified until exact checkpoint file is selected; metadata remains available', async () => {
  const f = await fixture()
  try {
    await f.click('Создать резервную копию')
    assert.deepEqual(f.calls, ['create', 'download'])
    assert.ok(!f.container.textContent.includes('Резервная копия проверена'))
    assert.ok(f.container.querySelector('details').textContent.includes('169'))
    assert.equal(f.active.at(-1), true)
    await f.select('saved.json')
    assert.ok(f.calls[2].receipt)
    assert.ok(f.container.textContent.includes('Резервная копия проверена'))
    assert.ok(f.container.querySelector('details').textContent.includes('saved.json'))
    assert.equal(f.active.at(-1), false)
  } finally { await f.close() }
})

test('existing file check has no checkpoint comparison or create/download call', async () => {
  const f = await fixture()
  try {
    await f.select('old.json')
    assert.deepEqual(f.calls, [{ file: 'old.json', receipt: undefined }])
    assert.ok(f.container.textContent.includes('Резервная копия проверена'))
  } finally { await f.close() }
})

test('Data actions belong to Settings Account', async () => {
  const { default: Settings } = await server.ssrLoadModule('/src/Settings.jsx')
  const page = new JSDOM(renderToStaticMarkup(createElement(Settings, { profile: { displayName: 'JW', dayStartMinutes: 0, timeZone: 'UTC' } })))
  try {
    const block = page.window.document.querySelector('.backup-data')
    assert.equal(block.closest('section').getAttribute('aria-labelledby'), 'settings-account')
    assert.equal(block.querySelector('h3').textContent, 'Данные')
    assert.deepEqual([...block.querySelectorAll('button')].map(b => b.textContent), ['Создать резервную копию', 'Проверить резервную копию'])
  } finally { page.window.close() }
})

test('cancelling file choice exits owned maintenance explicitly and never declares success', async () => {
  const f = await fixture()
  try {
    await f.click('Создать резервную копию')
    await act(async () => f.container.querySelector('input').dispatchEvent(new dom.window.Event('cancel', { bubbles: true })))
    assert.deepEqual(f.calls, ['create', 'download', 'resume'])
    assert.ok(!f.container.textContent.includes('Резервная копия проверена'))
    assert.equal(f.active.at(-1), false)
  } finally { await f.close() }
})

test('flush failure and verification failure expose recovery without silent maintenance exit', async () => {
  for (const options of [{ createFailure: 'flush failed' }, { verifyFailure: 'file damaged' }]) {
    const f = await fixture(options)
    try {
      await f.click('Создать резервную копию')
      if (options.verifyFailure) await f.select('bad.json')
      assert.ok(f.container.querySelector('[role=alert]'))
      assert.equal(f.active.at(-1), true)
      assert.ok(!f.calls.includes('resume'))
      await f.click('Вернуться к работе без проверки')
      assert.equal(f.active.at(-1), false)
      assert.equal(f.calls.at(-1), 'resume')
    } finally { await f.close() }
  }
})


test('last successful metadata survives remount, is replaced on success, and survives failure and cancellation', async () => {
  const storage = new Map()
  let f = await fixture({ storage })
  assert.equal(f.container.querySelector('.backup-last-verified'), null)
  await f.select('first.json')
  assert.ok(f.container.querySelector('.backup-last-verified').textContent.includes('33 текста'))
  assert.equal(f.container.querySelector('details').open, false)
  const first = [...storage.values()][0]
  await f.close()
  f = await fixture({ storage, verifyFailure: 'damaged' })
  assert.ok(f.container.querySelector('details').textContent.includes('first.json'))
  await f.select('bad.json')
  assert.equal([...storage.values()][0], first)
  assert.ok(f.container.querySelector('.backup-last-verified'))
  await f.close()
  f = await fixture({ storage })
  await f.click('Создать резервную копию')
  await act(async () => f.container.querySelector('input').dispatchEvent(new dom.window.Event('cancel')))
  assert.equal([...storage.values()][0], first)
  await f.select('second.json')
  assert.ok(f.container.querySelector('details').textContent.includes('second.json'))
  assert.notEqual([...storage.values()][0], first)
  await f.close()
})

test('backup actions stay disabled while verification is busy; creation remains disabled during maintenance', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = await fixture({ gate })
  try {
    await f.click('Создать резервную копию')
    const buttons = [...f.container.querySelectorAll('.backup-actions button')]
    assert.equal(buttons[0].disabled, true)
    assert.equal(buttons[1].disabled, false)
    const input = f.container.querySelector('input')
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['backup'], 'saved.json')] })
    await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })))
    assert.ok(buttons.every(button => button.disabled))
    await act(async () => release())
    assert.ok(buttons.every(button => !button.disabled))
  } finally { await f.close() }
})


test('Account displays creation date and text count compactly, with collapsed diagnostic details', async () => {
  const f = await fixture({ capturedAt: new Date(2026, 9, 6, 9, 52).getTime(), texts: 36 })
  try {
    await f.select('dated.json')
    assert.equal(f.container.querySelector('.backup-last-verified p').textContent, '6 октября 2026, 09:52 · 36 текстов')
    assert.equal(f.container.querySelector('details').open, false)
    assert.ok(f.container.querySelector('details').textContent.includes('PASS'))
    assert.ok(f.container.querySelector('details').textContent.includes('169'))
    assert.ok(!f.container.textContent.includes('Файл восстановлен и проверен в отдельной базе;'))
  } finally { await f.close() }
})
