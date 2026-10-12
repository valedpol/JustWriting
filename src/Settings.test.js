import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import { publicProfileField } from './domain/publicProfile.js'

const dom = new JSDOM('<body></body>', { url: 'https://settings.test', pretendToBeVisual: true })
const style = dom.window.document.createElement('style')
style.textContent = readFileSync(new URL('./Settings.css', import.meta.url), 'utf8')
dom.window.document.head.append(style)
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

async function fixture({ gate, failure, links = [] } = {}) {
  const container = document.createElement('div'), status = document.createElement('aside')
  document.body.append(container, status)
  let root = createRoot(container)
  const profile = { userId: 'private-id', displayName: 'Внутреннее имя', dayStartMinutes: 0, timeZone: 'UTC' }
  globalThis.__nicknameIdentity = { nickname: 'Старый ник', alias: 'Автор-7K3M', displayName: 'Старый ник', publicId: crypto.randomUUID(), allowNameDisclosure: false, profileVisible: false, about: '', links: structuredClone(links) }
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
    assert.equal(f.container.querySelector('.settings-resource input[type=url]').value, 'https://example.org')
    await click('Удалить'); await click('Сохранить ссылки'); await f.reopen()
    assert.equal(f.container.querySelector('.settings-resource'), null)
    await type(f.container.querySelector('textarea'), 'a'.repeat(301))
    await act(async () => f.container.querySelector('textarea').dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })))
    assert.equal(f.container.querySelector('textarea').value, 'a'.repeat(300))
    assert.equal(f.container.querySelector('#public-about-limit').textContent, '300 / 300')
    await f.reopen()
    assert.equal(f.container.querySelector('textarea').value, 'a'.repeat(300))
    await act(async () => globalThis.__nicknameBackupToggle(true))
    assert.equal(f.input('Показывать публичный профиль').disabled, true)
    assert.equal(f.container.querySelector('textarea').disabled, true)
    assert.equal([...f.container.querySelectorAll('button')].find(node => node.textContent === 'Добавить ссылку').disabled, true)
    assert.equal(f.input('Имя для себя').value, 'Внутреннее имя')
  } finally { await f.close() }
})

test('about counter sits below the textarea, updates live and enforces maxlength on typing and pasted input', async () => {
  const f = await fixture()
  const textarea = () => f.container.querySelector('textarea')
  const counter = () => f.container.querySelector('#public-about-limit')
  const input = async (value, inputType = 'insertText') => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(textarea(), value)
    textarea().dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType }))
  })
  try {
    assert.equal(textarea().maxLength, 300)
    assert.equal(textarea().nextElementSibling, counter())
    assert.equal(textarea().getAttribute('aria-describedby'), counter().id)
    assert.equal(counter().textContent, '0 / 300')
    await input('Привет')
    assert.equal(counter().textContent, '6 / 300')
    assert.equal(f.calls.length, 0, 'counter updates without saving')
    await input('a'.repeat(301))
    assert.equal(textarea().value, 'a'.repeat(300))
    assert.equal(counter().textContent, '300 / 300')
    await input('b'.repeat(700), 'insertFromPaste')
    assert.equal(textarea().value, 'b'.repeat(300))
    assert.equal(counter().textContent, '300 / 300')
    await input('c'.repeat(299) + '🙂', 'insertFromPaste')
    assert.equal(textarea().value, 'c'.repeat(299), 'truncation never leaves half a surrogate pair')
    assert.equal(counter().textContent, '299 / 300')
    await input('', 'deleteContentBackward')
    assert.equal(counter().textContent, '0 / 300')
  } finally { await f.close() }
})

test('public link settings save Telegram shorthand as HTTPS, keep readable labels and reject unsafe schemes', async () => {
  const f = await fixture()
  const click = async text => act(async () => [...f.container.querySelectorAll('button')].find(node => node.textContent === text).click())
  const input = async (node, value) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value)
    node.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  try {
    await click('Добавить ссылку')
    await input(f.container.querySelector('.settings-resource input'), 'Мой Telegram')
    for (const value of ['@User_name', 't.me/User_name']) {
      await input(f.container.querySelector('input[type=url]'), value)
      await click('Сохранить ссылки')
      await f.reopen()
      assert.equal(f.container.querySelector('input[type=url]').value, 'https://t.me/User_name')
      assert.deepEqual(globalThis.__nicknameIdentity.links, [{ label: 'Мой Telegram', url: 'https://t.me/User_name' }])
    }
    await input(f.container.querySelector('input[type=url]'), 'tg://resolve?domain=User_name')
    await click('Сохранить ссылки')
    assert.equal(f.status.textContent, 'Укажи безопасный URL https://.')
    await f.reopen()
    assert.equal(f.container.querySelector('input[type=url]').value, 'https://t.me/User_name')
  } finally { await f.close() }
})

test('saved public links form a compact accessible list; only new rows show labels and name presets until saved', async () => {
  const saved = [{ label: 'Facebook', url: 'https://facebook.com/example' }, { label: 'Сайт', url: 'https://example.org' }]
  const f = await fixture({ links: saved })
  const click = async text => act(async () => [...f.container.querySelectorAll('button')].find(node => node.textContent === text).click())
  const input = async (node, value) => act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(node, value)
    node.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  try {
    const savedRows = [...f.container.querySelectorAll('.public-link-saved')]
    assert.equal(savedRows.length, 2)
    for (const row of savedRows) {
      assert.deepEqual([...row.querySelectorAll('label')].map(label => label.textContent), ['', ''])
      assert.ok(row.querySelector('input').getAttribute('aria-label').startsWith('Название публичной ссылки'))
      assert.ok(row.querySelector('input[type=url]').getAttribute('aria-label').startsWith('URL публичной ссылки'))
      assert.equal(row.querySelector('.public-link-presets'), null)
    }
    await click('Добавить ссылку')
    const editing = f.container.querySelector('.public-link-new')
    assert.deepEqual([...editing.querySelectorAll('label')].map(label => label.textContent), ['Название', 'URL'])
    const presets = [...editing.querySelectorAll('.public-link-presets button')]
    assert.deepEqual(presets.map(node => node.textContent), ['Telegram', 'Instagram', 'Facebook', 'YouTube', 'X'])
    await input(editing.querySelector('input[type=url]'), '@User_name')
    for (const preset of presets) {
      await act(async () => preset.click())
      assert.equal(editing.querySelector('input').value, preset.textContent)
      assert.equal(editing.querySelector('input[type=url]').value, '@User_name', 'name selection never edits the URL')
    }
    await input(editing.querySelector('input'), 'Мой Telegram')
    assert.equal(f.calls.length, 0, 'presets and manual edits do not save implicitly')
    const savedStyle = dom.window.getComputedStyle(savedRows[0]), newStyle = dom.window.getComputedStyle(editing)
    assert.ok(parseFloat(savedStyle.marginBottom) < parseFloat(newStyle.marginBottom))
    assert.ok(parseFloat(savedStyle.gap) < parseFloat(newStyle.gap))
    assert.equal(savedStyle.fontSize, newStyle.fontSize, 'compact rows retain the same text size')
    assert.equal(dom.window.getComputedStyle(savedRows[0].querySelector('button')).minHeight, '32px')
    await click('Сохранить ссылки')
    assert.deepEqual(f.calls, [['links', [...saved, { label: 'Мой Telegram', url: '@User_name' }]]], 'presentation metadata never reaches onSave')
    assert.equal(f.container.querySelector('.public-link-new'), null)
    assert.equal(f.container.querySelectorAll('.public-link-saved').length, 3)
    await f.reopen()
    assert.equal(f.container.querySelectorAll('.public-link-saved').length, 3)
    assert.equal(f.container.querySelector('.public-link-presets'), null)
    assert.equal(f.container.querySelectorAll('input[type=url]')[2].value, 'https://t.me/User_name')
  } finally { await f.close() }
})

test('deleting saved and new neighbours preserves row presentation and backup disables all new-row controls', async () => {
  const f = await fixture({ links: [{ label: 'Сайт', url: 'https://example.org' }] })
  const click = async node => act(async () => node.click())
  const add = () => [...f.container.querySelectorAll('button')].find(node => node.textContent === 'Добавить ссылку')
  try {
    await click(add()); await click(add())
    assert.equal(f.container.querySelectorAll('.public-link-new').length, 2)
    await click(f.container.querySelector('.public-link-saved .public-link-delete'))
    assert.equal(f.container.querySelectorAll('.public-link-saved').length, 0)
    assert.equal(f.container.querySelectorAll('.public-link-new').length, 2)
    await click(f.container.querySelector('.public-link-new .public-link-delete'))
    assert.equal(f.container.querySelectorAll('.public-link-new').length, 1)
    assert.deepEqual([...f.container.querySelectorAll('.settings-resource label')].map(node => node.textContent), ['Название', 'URL'])
    await act(async () => globalThis.__nicknameBackupToggle(true))
    assert.ok([...f.container.querySelectorAll('.settings-resource input, .settings-resource button')].every(node => node.disabled))
    assert.equal(f.calls.length, 0)
    assert.equal(globalThis.__nicknameIdentity.links.length, 1, 'removal remains a draft until save')
  } finally { await f.close() }
})

test('failed link save keeps the new row and presets while persisted rows remain compact', async () => {
  const f = await fixture({ links: [{ label: 'Сайт', url: 'https://example.org' }], failure: 'Запись недоступна' })
  const click = async text => act(async () => [...f.container.querySelectorAll('button')].find(node => node.textContent === text).click())
  try {
    await click('Добавить ссылку')
    await click('Telegram')
    await click('Сохранить ссылки')
    assert.equal(f.status.textContent, 'Запись недоступна')
    assert.equal(f.container.querySelectorAll('.public-link-saved').length, 1)
    assert.equal(f.container.querySelector('.public-link-new input').value, 'Telegram')
    assert.equal(f.container.querySelectorAll('.public-link-presets button').length, 5)
    await f.reopen()
    assert.equal(f.container.querySelector('.public-link-new'), null)
    assert.equal(f.container.querySelectorAll('.public-link-saved').length, 1)
  } finally { await f.close() }
})
