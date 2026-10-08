import test from 'node:test'
import assert from 'node:assert/strict'
import { assertPublicNicknameAvailable, publicNicknameKey, initializePublicIdentity, normalizePublicNickname, resolvePublicIdentity } from './publicIdentity.js'

test('random identity is stored once, independent of userId and internal name', () => {
  const userId = 'local:private-user-identifier'
  const settings = initializePublicIdentity(userId, { userId, displayName: 'Private' })
  const fallback = resolvePublicIdentity(userId, settings)
  assert.match(fallback.alias, /^Автор-[0-9A-HJKMNP-TV-Z]{4}$/)
  assert.notEqual(fallback.publicId, userId)
  assert.deepEqual(initializePublicIdentity(userId, settings), settings)
  assert.notEqual(initializePublicIdentity(userId).publicId, settings.publicId, 'fresh random identity is not a userId hash')
  assert.equal(JSON.stringify(fallback).includes('Private'), false)
  assert.equal(JSON.stringify(fallback).includes(userId), false)
  assert.equal(Object.isFrozen(fallback), true)
})

for (const nickname of ['', 'Mumipol']) for (const allowNameDisclosure of [false, true]) {
  test(`display matrix: nickname=${nickname || 'empty'}, disclosure=${allowNameDisclosure}`, () => {
    const settings = initializePublicIdentity('user', { userId: 'user', publicNickname: nickname, allowNameDisclosure })
    const identity = resolvePublicIdentity('user', settings)
    assert.equal(identity.displayName, nickname || settings.publicAlias)
    assert.equal(identity.displayLabel, (nickname || settings.publicAlias) + (allowNameDisclosure ? ' ›' : ''))
    assert.equal('fullName' in identity, false)
    assert.equal(identity.alias, resolvePublicIdentity('user', { ...settings, publicNickname: 'Changed' }).alias)
  })
}

test('three authors have distinct public keys; display spelling is independent of the uniqueness contract', () => {
  const identities = ['a', 'b', 'c'].map(userId => resolvePublicIdentity(userId,
    initializePublicIdentity(userId, { userId, publicNickname: 'Same Ник' })))
  assert.equal(new Set(identities.map(identity => identity.publicId)).size, 3)
  assert.ok(identities.every(identity => identity.displayName === 'Same Ник'))
  assert.equal(normalizePublicNickname('  Mixed CASE-é  '), 'Mixed CASE-é')
  assert.throws(() => normalizePublicNickname(123), /текстом/)
  assert.throws(() => initializePublicIdentity('a', { userId: 'b' }), /mismatch/)
  assert.throws(() => initializePublicIdentity('a', { userId: 'a', allowNameDisclosure: 'true' }), /identity/)
  assert.throws(() => resolvePublicIdentity('a', { userId: 'a' }), /identity/)
})


test('nickname comparison trims, ignores case and canonical Unicode differences without changing display spelling', () => {
  assert.equal(publicNicknameKey('  Mumipol  '), publicNicknameKey('mumipol'))
  assert.equal(publicNicknameKey('Éva'), publicNicknameKey('e\u0301VA'))
  assert.equal(normalizePublicNickname('  E\u0301va  '), 'E\u0301va')
  assert.notEqual(publicNicknameKey('Name Name'), publicNicknameKey('Name  Name'))
  assert.notEqual(publicNicknameKey('Ａ'), publicNicknameKey('A'), 'NFC does not apply compatibility substitutions')
  assert.throws(() => publicNicknameKey(null), /текстом/)
  const directory = [{ publicId: 'first', publicNickname: 'Éva' }]
  assert.throws(() => assertPublicNicknameAvailable(' e\u0301VA ', 'second', directory), /Этот никнейм уже занят/)
  assert.doesNotThrow(() => assertPublicNicknameAvailable('éVA', 'first', directory))
  assert.doesNotThrow(() => assertPublicNicknameAvailable('', 'second', directory))
})
