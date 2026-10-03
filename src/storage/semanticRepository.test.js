import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transaction } from './database.js'
import { resolveToday } from './dayRepository.js'
import { saveText, saveRichText, loadText } from './textRepository.js'
import { saveSemanticMarkup } from './semanticRepository.js'
import { archiveDocument } from '../editor/archiveDocument.js'
import { legacyToDocument, documentToContent, parseDocument } from '../editor/document.js'
import { getWordCount } from '../domain/wordCount.js'

const now = Date.parse('2026-10-01T12:00:00Z')
const tag = { id: 'tag', kind: 'tag', valueId: 'v', value: 'метка', source: 'selection', direction: 'backward', anchor: 4, range: { from: 1, to: 4 }, assignedAt: now }
async function setup(content = 'Авторский текст', legacy = false) {
  const profile = { userId: crypto.randomUUID(), timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 }
  const { context } = await resolveToday(profile, now)
  const document = legacyToDocument(content)
  if (document.content[0].content) document.content[0].content[0].marks = [{ type: 'bold' }]
  const record = legacy ? await saveText(context, null, content, now)
    : await saveRichText(context, null, { contentFormat: 'tiptap-json', contentVersion: 1, document, semanticMarkup: [] }, now)
  await resolveToday(profile, now + 86400000)
  return { profile, context, record }
}
const otherStores = () => transaction(['settings', 'userDays', 'wordCountSamples'], 'readonly', (tx, done) => {
  const result = {}
  for (const name of ['settings', 'userDays', 'wordCountSamples']) {
    const request = tx.objectStore(name).getAll()
    request.onsuccess = () => { result[name] = request.result }
  }
  done(result)
})

test('closed archive metadata changes only semanticMarkup and revision; text path stays closed', async () => {
  const { profile, context, record } = await setup()
  const before = await otherStores()
  const saved = await saveSemanticMarkup(profile.userId, record, [tag])
  assert.deepEqual(saved, { ...record, semanticMarkup: [tag], revision: record.revision + 1 })
  assert.deepEqual(await otherStores(), before)
  assert.deepEqual(await loadText(profile.userId, record.dayKey), saved)
  await assert.rejects(saveRichText(context, saved, saved, now + 86400000), /закрыт/)
  assert.deepEqual(await loadText(profile.userId, record.dayKey), saved)
})

test('archive writes reject stale revision, wrong owner and invalid ranges atomically', async () => {
  const { profile, record } = await setup()
  for (const invalid of [[{ ...tag, anchor: 1000 }], [{ ...tag, range: { from: 1, to: 999 } }], [tag, tag]]) {
    await assert.rejects(saveSemanticMarkup(profile.userId, record, invalid))
  }
  await assert.rejects(saveSemanticMarkup('other', record, [tag]), /пользователю/)
  assert.deepEqual(await loadText(profile.userId, record.dayKey), record)
  const results = await Promise.allSettled([saveSemanticMarkup(profile.userId, record, [tag]), saveSemanticMarkup(profile.userId, record, [{ ...tag, value: 'other' }])])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.filter(r => r.status === 'rejected').length, 1)
})

test('legacy archive migration preserves literal text, every line break, word count and unrelated fields', async () => {
  const text = ' **literal**\r\n\r\n#тег <tag>\n хвост \n'
  const { profile, record } = await setup(text, true)
  const before = await otherStores()
  const doc = archiveDocument(record)
  assert.equal(documentToContent(doc), text.replace(/\r\n/g, '\n'))
  assert.equal(doc.content.length, 1)
  assert.equal(doc.content[0].content.filter(n => n.type === 'hardBreak').length, 4)
  assert.deepEqual(await loadText(profile.userId, record.dayKey), record) // Read-only opening never migrates.
  const saved = await saveSemanticMarkup(profile.userId, record, [tag])
  assert.deepEqual(saved, { ...record, revision: record.revision + 1, semanticMarkup: [tag], contentFormat: 'tiptap-json', contentVersion: 1, document: doc })
  assert.equal(saved.content, text)
  assert.equal(getWordCount(saved.content), getWordCount(record.content))
  assert.deepEqual(archiveDocument(saved), doc)
  assert.deepEqual(await otherStores(), before)
  assert.ok(parseDocument(saved.document))
  const removed = await saveSemanticMarkup(profile.userId, saved, [])
  assert.deepEqual(removed, { ...saved, semanticMarkup: [], revision: saved.revision + 1 })
  assert.equal(removed.content, text)
  assert.equal(getWordCount(removed.content), getWordCount(record.content))
  assert.deepEqual(await loadText(profile.userId, record.dayKey), removed)
  assert.deepEqual(await otherStores(), before)
})
