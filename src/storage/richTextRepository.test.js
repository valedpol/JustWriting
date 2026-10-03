import 'fake-indexeddb/auto'
import { IDBObjectStore } from 'fake-indexeddb'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saveText, saveRichText, loadText, listTexts } from './textRepository.js'
import { transaction } from './database.js'
import { resolveToday, loadUserDay } from './dayRepository.js'
import { GRACE_DURATION } from '../domain/grace.js'
import { documentFromRecord, legacyToDocument } from '../editor/document.js'
import { getWordCount } from '../domain/wordCount.js'

const now = Date.parse('2026-10-01T12:00:00Z')
const snapshot = (text = 'Авторский текст', semanticMarkup = []) => ({
  contentFormat: 'tiptap-json', contentVersion: 1,
  document: legacyToDocument(text), content: 'Неверная проекция', semanticMarkup,
})
const tag = (overrides = {}) => ({ id: 'tag-1', valueId: 'value-1', kind: 'tag', value: 'заметки', source: 'slash', anchor: 1, direction: 'backward', range: null, ...overrides })
async function setup() {
  const profile = { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 }
  return { profile, ...(await resolveToday(profile, now)) }
}
const storedState = () => transaction(['texts', 'userDays', 'wordCountSamples'], 'readonly', (tx, done) => {
  const result = {}
  for (const name of ['texts', 'userDays', 'wordCountSamples']) {
    const request = tx.objectStore(name).getAll()
    request.onsuccess = () => { result[name] = request.result }
  }
  done(result)
})

test('rich blank input and semantic markup alone create neither text nor day; rule is content with zero words', async () => {
  const { context } = await setup()
  for (const value of ['', ' \n\t']) {
    assert.equal(await saveRichText(context, null, snapshot(value, [tag()]), now), null)
  }
  assert.equal(await loadText(context.userId, context.dayKey), null)
  assert.equal(await loadUserDay(context.userId, context.dayKey), null)
  const value = snapshot('')
  value.document.content.unshift({ type: 'horizontalRule' })
  const saved = await saveRichText(context, null, value, now)
  assert.equal(saved.content, '\n')
  assert.equal(getWordCount(saved.content), 0)
  assert.deepEqual((await loadText(context.userId, context.dayKey)).document, value.document)
})

test('rich snapshot derives projection and detaches inputs; formatting, semantics and clearing retain identity', async () => {
  const { context } = await setup()
  const input = snapshot('Авторский текст\n#осень', [tag()])
  const saving = saveRichText(context, null, input, now)
  input.document.content[0].content[0].text = 'Изменён после вызова'
  input.semanticMarkup[0].value = 'Изменён после вызова'
  const original = await saving
  assert.equal(original.content, 'Авторский текст\n#осень')
  assert.equal(original.semanticMarkup[0].value, 'заметки')
  assert.equal(getWordCount(original.content), 3)
  const formatted = structuredClone(original)
  formatted.document.content[0].content[0].marks = [{ type: 'bold' }]
  const second = await saveRichText(context, original, formatted, now)
  assert.equal(second.content, original.content)
  assert.equal(second.revision, original.revision + 1)
  const semantic = { ...second, semanticMarkup: [tag({ value: 'другое' })] }
  const third = await saveRichText(context, second, semantic, now)
  assert.equal(third.content, second.content)
  assert.equal(third.revision, second.revision + 1)
  const cleared = await saveRichText(context, third, snapshot(''), now)
  for (const key of ['textId', 'userDayId', 'createdAt', 'dayKey', 'dayStartsAt', 'dayEndsAt']) assert.equal(cleared[key], original[key])
  assert.equal(cleared.content, '')
  assert.deepEqual(await loadText(context.userId, context.dayKey), cleared)
})

test('legacy reads never migrate; explicit rich edit converts literally and retains identity', async () => {
  const { context } = await setup()
  const literal = '**слово**\n__слово__ #осень <tag>\n\n'
  const original = await saveText(context, null, literal, now)
  const before = await storedState()
  const loaded = await loadText(context.userId, context.dayKey)
  documentFromRecord(loaded)
  await listTexts(context.userId)
  assert.deepEqual(await storedState(), before)
  assert.equal(loaded.contentFormat, undefined)
  const value = snapshot(literal)
  value.document.content[0].content[0].marks = [{ type: 'italic' }]
  const converted = await saveRichText(context, original, value, now)
  assert.equal(converted.content, literal)
  assert.equal(converted.textId, original.textId)
  assert.equal(converted.userDayId, original.userDayId)
  assert.equal(converted.createdAt, original.createdAt)
  assert.equal(converted.revision, original.revision + 1)
  await assert.rejects(saveText(context, converted, 'plain overwrite', now), /plain text/)
  assert.deepEqual(await loadText(context.userId, context.dayKey), converted)
})

test('concurrent rich writes commit one complete snapshot and reject stale revisions', async () => {
  const { context } = await setup()
  const first = await saveRichText(context, null, snapshot(), now)
  const results = await Promise.allSettled([
    saveRichText(context, first, snapshot('Версия А', [tag({ value: 'А' })]), now),
    saveRichText(context, first, snapshot('Версия Б', [tag({ value: 'Б' })]), now),
  ])
  assert.equal(results.filter(r => r.status === 'rejected').length, 1)
  const winner = results.find(r => r.status === 'fulfilled').value
  assert.deepEqual(await loadText(context.userId, context.dayKey), winner)
  assert.equal(winner.content, winner.document.content[0].content[0].text)
  assert.equal(winner.content.at(-1), winner.semanticMarkup[0].value)
  assert.equal(winner.revision, first.revision + 1)
})

test('invalid format, JSON and semantic metadata reject atomically', async () => {
  const { context } = await setup()
  const first = await saveRichText(context, null, snapshot(), now)
  const before = await storedState()
  const invalid = [null, { ...snapshot(), contentFormat: 'html' }, { ...snapshot(), contentVersion: 2 },
    { ...snapshot(), document: { type: 'doc', content: [{ type: 'heading' }] } },
    { ...snapshot(), semanticMarkup: {} }, ...[
      { anchor: 999 }, { direction: 'forward' }, { kind: 'script' }, { source: 'selection' },
      { range: { from: 4, to: 2 } }, { range: { from: 1, to: 999 } }, { value: {} },
    ].map(overrides => snapshot('Авторский текст', [tag(overrides)])),
    snapshot('Авторский текст', [tag(), tag()])]
  for (const value of invalid) await assert.rejects(saveRichText(context, first, value, now))
  assert.deepEqual(await storedState(), before)
})

test('unknown stored versions cannot be overwritten through either writer', async () => {
  const { context } = await setup()
  const first = await saveRichText(context, null, snapshot(), now)
  const future = { ...first, contentVersion: 99 }
  await transaction(['texts'], 'readwrite', (tx) => tx.objectStore('texts').put(future))
  await assert.rejects(saveRichText(context, future, snapshot(), now), /версия/)
  await assert.rejects(saveText(context, future, 'перезапись', now), /версия/)
  assert.deepEqual(await loadText(context.userId, context.dayKey), future)
})

test('storage abort rolls back the whole rich snapshot and day changes', async () => {
  const { context } = await setup()
  const first = await saveRichText(context, null, snapshot(), now, 'first-session')
  const before = await storedState()
  const put = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function (...args) {
    const request = put.apply(this, args)
    if (this.name === 'texts') request.addEventListener('success', () => this.transaction.abort())
    return request
  }
  try {
    await assert.rejects(saveRichText(context, first, snapshot('Новый текст', [tag()]), now, 'new-session'))
  } finally {
    IDBObjectStore.prototype.put = put
  }
  assert.deepEqual(await storedState(), before)
})

test('rich saves obey existing session ownership and exact grace deadline', async () => {
  const { context, profile } = await setup()
  const first = await saveRichText(context, null, snapshot(), now, 'owner')
  await resolveToday(profile, context.dayEndsAt, 'owner')
  const updated = await saveRichText(context, first, snapshot('В grace'), context.dayEndsAt + 1, 'owner')
  await assert.rejects(saveRichText(context, updated, snapshot('Чужая сессия'), context.dayEndsAt + 2, 'stranger'), /закрыт/)
  await assert.rejects(saveRichText(context, updated, snapshot('Поздно'), context.dayEndsAt + GRACE_DURATION, 'owner'), /закрыт/)
  assert.deepEqual(await loadText(context.userId, context.dayKey), updated)
})
