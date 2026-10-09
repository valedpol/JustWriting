import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createServer } from 'vite'
import { publicProfileField } from './domain/publicProfile.js'

const dom = new JSDOM('<body></body>', { url: 'https://settings.test', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error',
  plugins: [{ name: 'public-nickname-settings-fixtures', enforce: 'pre', transform(_code, id) {
    if (id.endsWith('/src/storage/publicIdentityRepository.js')) return 'export const loadPublicIdentity = async () => structuredClone(globalThis.__nicknameIdentity)'
    if (id.endsWith('/src/components/BackupData.jsx')) return 'export default function BackupData(props) { globalThis.__nicknameBackupToggle = props.onActiveChange; return null }'
  } }] })
const { default: Settings } = await server.ssrLoadModule('/src/Settings.jsx')
after(async () => { delete globalThis.__nicknameIdentity; delete globalThis.__nicknameBackupToggle; await server.close(); dom.window.close() })

test('pin management lives in owner Profile publications rather than public profile settings', async () => {
  const f = await fixture()
  try {
    assert.equal(f.container.textContent.includes('Закреплённая публикация'), false)
    assert.equal(f.container.textContent.includes('Закрепить в профиле'), false)
  } finally { await f.close() }
})

async function fixture({ gate, failure } = {}) {
  const container = document.createElement('div'), status = document.createElement('aside')
  document.body.append(container, status)
  let root = createRoot(container)
  const profile = { userId: 'private-id', displayName: 'Внутреннее имя', dayStartMinutes: 0, timeZone: 'UTC' }
  globalThis.__nicknameIdentity = { nickname: 'Старый ник', alias: 'Автор-7K3M', displayName: 'Старый ник', publicId: crypto.randomUUID(), allowNameDisclosure: false, profileVisible: false, about: '', links: [] }
  const calls = []
  const save = async (field, value) => {
    calls.push([field, value])
    await gate
    if (failure) throw new Error(failure)
    if (['profileVisible', 'about', 'links', 'pinnedPublicationId'].includes(field)) {
      const stored = publicProfileField(field, value)
      globalThis.__nicknameIdentity[field] = stored
      return { publicProfile: { [field]: stored }, deferred: false }
    }
    if (field === 'allowNameDisclosure') {
      globalThis.__nicknameIdentity.allowNameDisclosure = value
      return { publicProfile: { allowNameDisclosure: value }, deferred: false }
    }
    const nickname = value.trim()
    globalThis.__nicknameIdentity = { ...globalThis.__nicknameIdentity, nickname, displayName: nickname || globalThis.__nicknameIdentity.alias }
    return { publicProfile: { publicNickname: nickname }, deferred: false }
  }
  const render = async () => act(async () => root.render(createElement(Settings, { profile, onSave: save, statusHost: status })))
  const input = label => [...container.querySelectorAll('label.settings-row')].find(node => node.querySelector('span')?.textContent === label).querySelector('input')
  await render()
  return { container, status, profile, calls, input,
    async type(value) { await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input('Публичный никнейм'), value)
      input('Публичный никнейм').dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    }) },
    async blur() { await act(async () => input('Публичный никнейм').dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }))) },
    async reopen() { await act(async () => root.unmount()); root = createRoot(container); await render() },
    async close() { await act(async () => root.unmount()); container.remove(); status.remove() } }
}

test('public nickname is a separate persisted field; clearing returns to the same alias and never changes internal name', async () => {
  const f = await fixture()
  try {
    assert.equal(f.input('Имя для себя').value, 'Внутреннее имя')
    assert.equal(f.input('Публичный никнейм').value, 'Старый ник')
    await f.type('  Новый ник  '); await f.blur()
    assert.deepEqual(f.calls, [['publicNickname', '  Новый ник  ']])
    assert.equal(f.input('Публичный никнейм').value, 'Новый ник')
    await f.reopen()
    assert.equal(f.input('Публичный никнейм').value, 'Новый ник')
    await f.type(''); await f.blur()
    await f.reopen()
    assert.equal(f.input('Публичный никнейм').value, '')
    assert.equal(f.input('Публичный никнейм').placeholder, 'Автор-7K3M')
    assert.equal(f.input('Имя для себя').value, 'Внутреннее имя')
    assert.equal(f.profile.displayName, 'Внутреннее имя')
  } finally { await f.close() }
})

test('public nickname respects settings busy and backup-active disabled states', async () => {
  let resolve
  const f = await fixture({ gate: new Promise(done => { resolve = done }) })
  try {
    await act(async () => globalThis.__nicknameBackupToggle(true))
    assert.equal(f.input('Публичный никнейм').disabled, true)
    await act(async () => globalThis.__nicknameBackupToggle(false))
    assert.equal(f.input('Публичный никнейм').disabled, false)
    await f.type('Новый'); await f.blur()
    assert.equal(f.input('Публичный никнейм').disabled, true)
    assert.equal(f.input('Имя для себя').disabled, true)
    await act(async () => resolve())
    assert.equal(f.input('Публичный никнейм').disabled, false)
  } finally { resolve(); await f.close() }
})

test('failed public nickname save keeps the draft, previous stored nickname and internal name', async () => {
  const f = await fixture({ failure: 'Запись недоступна' })
  try {
    await f.type('Не сохранён'); await f.blur()
    assert.equal(f.status.textContent, 'Запись недоступна')
    assert.equal(f.input('Публичный никнейм').value, 'Не сохранён')
    await f.reopen()
    assert.equal(f.input('Публичный никнейм').value, 'Старый ник')
    assert.equal(f.input('Имя для себя').value, 'Внутреннее имя')
  } finally { await f.close() }
})

test('settings render before the profile is available with the public nickname disabled', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(Settings, { onSave() { throw new Error('No profile yet') } })))
    const input = [...container.querySelectorAll('label.settings-row')].find(node => node.querySelector('span')?.textContent === 'Публичный никнейм').querySelector('input')
    assert.equal(input.value, '')
    assert.equal(input.disabled, true)
  } finally { await act(async () => root.unmount()); container.remove() }
})


test('disclosure defaults off, persists after reopen and has no third name field', async () => {
  const f = await fixture()
  try {
    const checkbox = () => f.input('Разрешить раскрывать имя')
    assert.equal(checkbox().checked, false)
    await act(async () => checkbox().click())
    assert.deepEqual(f.calls, [['allowNameDisclosure', true]])
    assert.equal(checkbox().checked, true)
    await f.reopen()
    assert.equal(checkbox().checked, true)
    assert.equal(f.input('Имя для себя').value, 'Внутреннее имя')
    await act(async () => globalThis.__nicknameBackupToggle(true))
    assert.equal(checkbox().disabled, true)
    assert.equal(f.container.textContent.includes('Полное имя'), false)
  } finally { await f.close() }
})

test('failed disclosure save retains the previous permission', async () => {
  const f = await fixture({ failure: 'Запись недоступна' })
  try {
    await act(async () => f.input('Разрешить раскрывать имя').click())
    assert.equal(f.input('Разрешить раскрывать имя').checked, false)
    await f.reopen()
    assert.equal(f.input('Разрешить раскрывать имя').checked, false)
  } finally { await f.close() }
})

test('nickname collision shows the quiet repository message and keeps the saved identity', async () => {
  const f = await fixture({ failure: 'Этот никнейм уже занят.' })
  try {
    await f.type('Mumipol'); await f.blur()
    assert.equal(f.status.textContent, 'Этот никнейм уже занят.')
    assert.equal(f.input('Публичный никнейм').value, 'Mumipol')
    await f.reopen()
    assert.equal(f.input('Публичный никнейм').value, 'Старый ник')
    assert.equal(f.input('Имя для себя').value, 'Внутреннее имя')
  } finally { await f.close() }
})


test('public profile permission, about and HTTPS links persist independently; link removal and busy/backup gates work', async () => {
  const f = await fixture()
  const click = async text => act(async () => [...f.container.querySelectorAll('button')].find(node => node.textContent === text).click())
  const type = async (node, value) => act(async () => {
    const prototype = node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value)
    node.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  try {
    assert.equal(f.input('Показывать публичный профиль').checked, false)
    await act(async () => f.input('Показывать публичный профиль').click())
    assert.equal(f.input('Показывать публичный профиль').checked, true)
    assert.equal(f.input('Разрешить раскрывать имя').checked, false)
    await type(f.container.querySelector('textarea'), 'О себе')
    await act(async () => f.container.querySelector('textarea').dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })))
    await click('Добавить ссылку')
    const fields = f.container.querySelectorAll('.settings-resource input')
    await type(fields[0], 'Сайт'); await type(fields[1], 'https://example.org')
    await click('Сохранить ссылки')
    await f.reopen()
    assert.equal(f.input('Показывать публичный профиль').checked, true)
    assert.equal(f.container.querySelector('textarea').value, 'О себе')
    assert.equal(f.container.querySelector('.settings-resource input[type=url]').value, 'https://example.org/')
    await click('Удалить'); await click('Сохранить ссылки'); await f.reopen()
    assert.equal(f.container.querySelector('.settings-resource'), null)
    await type(f.container.querySelector('textarea'), 'a'.repeat(301))
    await act(async () => f.container.querySelector('textarea').dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })))
    assert.equal(f.status.textContent, 'О себе — не более 300 символов.')
    await f.reopen()
    assert.equal(f.container.querySelector('textarea').value, 'О себе')
    await act(async () => globalThis.__nicknameBackupToggle(true))
    assert.equal(f.input('Показывать публичный профиль').disabled, true)
    assert.equal(f.container.querySelector('textarea').disabled, true)
    assert.equal([...f.container.querySelectorAll('button')].find(node => node.textContent === 'Добавить ссылку').disabled, true)
    assert.equal(f.input('Имя для себя').value, 'Внутреннее имя')
  } finally { await f.close() }
})
