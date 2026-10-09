import test from 'node:test'
import assert from 'node:assert/strict'
import { publicProfileField, publicProfileDetails, publicAuthorStats } from './publicProfile.js'

test('missing profile permission is false without mutating settings; permission is independent of reveal', () => {
  const settings = { allowNameDisclosure: true }
  assert.deepEqual(publicProfileDetails(settings), { profileVisible: false, about: '', links: [], pinnedPublicationId: null })
  assert.deepEqual(settings, { allowNameDisclosure: true })
  assert.equal(publicProfileDetails({ profileVisible: true, allowNameDisclosure: false }).profileVisible, true)
  assert.throws(() => publicProfileField('profileVisible', 'true'), /boolean/)
})
test('profile pin is an optional single publication pointer, never a snapshot or list', () => {
  assert.equal(publicProfileField('pinnedPublicationId', null), null)
  assert.equal(publicProfileField('pinnedPublicationId', 'publication-id'), 'publication-id')
  for (const value of ['', ' ', [], {}, true]) assert.throws(() => publicProfileField('pinnedPublicationId', value))
})
test('about preserves plain text up to 300 Unicode characters, rejects over-limit or non-text', () => {
  assert.equal(publicProfileField('about', '🙂'.repeat(300)), '🙂'.repeat(300))
  assert.throws(() => publicProfileField('about', 'a'.repeat(301)), /300/)
  assert.throws(() => publicProfileField('about', null), /300/)
})
test('public links allow safe HTTPS only, strip extra fields and never expose unsafe schemes/credentials', () => {
  assert.deepEqual(publicProfileField('links', [{ label: ' Сайт ', url: 'https://example.org', secret: 'Private' }]), [{ label: 'Сайт', url: 'https://example.org/' }])
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/x', 'http://example.org', '//example.org', 'https://user:pass@example.org', 'bad']) {
    assert.throws(() => publicProfileField('links', [{ label: 'Сайт', url }]))
  }
  assert.throws(() => publicProfileField('links', [{ label: '', url: 'https://example.org' }]))
})
test('stats projection retains only aggregates and trustworthy dates; unavailable values never turn into zero/date-now', () => {
  assert.equal(publicAuthorStats(null), null)
  assert.deepEqual(publicAuthorStats({ writingDays: 12, totalWords: 30, joinedAt: undefined, private: true }), { writingDays: 12, totalWords: 30, joinedAt: null })
  assert.deepEqual(publicAuthorStats({ writingDays: 12, totalWords: 30, joinedAt: NaN }), { writingDays: 12, totalWords: 30, joinedAt: null })
  assert.throws(() => publicAuthorStats({ writingDays: -1, totalWords: 30 }))
})
