import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzePublicationAnchors } from './anchorRecovery.js'

const data = (content, snapshot) => ({ texts: [{ textId: 't', userId: 'u', userDayId: 'd', dayKey: 'day', revision: 9, content }],
  userDays: [{ userDayId: 'd', userId: 'u', dayKey: 'day' }], publications: [{ publicationId: 'p', userId: 'u', channel: 'feed',
    source: { sourceType: 'archive', sourceId: 't', sourceRevision: 1, range: { from: 1, to: 4 }, archive: { userDayId: 'd', dayKey: 'day' } },
    snapshot: { content: snapshot, title: 'Never an anchor' } }] })
test('exact recovery preserves Unicode, spaces and legacy line endings; title is not used as an anchor', async () => {
  const value = data('before 😀\r\ntext after', '😀\r\ntext')
  const before = structuredClone(value), [report] = await analyzePublicationAnchors(value)
  assert.equal(report.status, 'unique-exact-candidate')
  assert.deepEqual(report.candidates, [{ from: 8, to: 15 }])
  assert.deepEqual(value, before)
  const [normalized] = await analyzePublicationAnchors(data('a\nb', 'a\r\nb'))
  assert.equal(normalized.status, 'no-exact-match')
})
test('repeated text is ambiguous; changed interior, missing source and invalid coordinates never produce an automatic repair', async () => {
  assert.equal((await analyzePublicationAnchors(data('text text', 'text')))[0].status, 'ambiguous')
  assert.equal((await analyzePublicationAnchors(data('begin CHANGED end', 'begin old end')))[0].status, 'no-exact-match')
  const missing = data('text', 'text'); missing.texts = []
  assert.equal((await analyzePublicationAnchors(missing))[0].status, 'source-unavailable')
})
