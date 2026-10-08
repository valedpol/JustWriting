export function normalizePublicNickname(value) {
  if (typeof value !== 'string') throw new Error('Публичный никнейм должен быть текстом.')
  return value.trim()
}

// Comparison only: never replace the user's display spelling with this key.
export function publicNicknameKey(value) {
  return normalizePublicNickname(value).normalize('NFC').toLowerCase().normalize('NFC')
}

// This contract checks the supplied identity directory, not global availability.
export function assertPublicNicknameAvailable(value, publicId, identities) {
  const key = publicNicknameKey(value)
  if (!key) return // Clearing releases the nickname and retains the stable alias.
  if (identities.some(identity => identity.publicId !== publicId &&
      publicNicknameKey(identity.publicNickname ?? '') === key)) throw new Error('Этот никнейм уже занят.')
}

// Independent random public identifiers, never derived from private userId.
export function initializePublicIdentity(userId, settings) {
  if (typeof userId !== 'string' || !userId) throw new Error('Invalid public profile owner')
  if (settings && settings.userId !== userId) throw new Error('Public profile owner mismatch')
  const next = { ...settings, userId }
  if (next.publicId === undefined) next.publicId = crypto.randomUUID()
  if (next.publicAlias === undefined) {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
    const bytes = crypto.getRandomValues(new Uint8Array(4))
    next.publicAlias = `Автор-${Array.from(bytes, byte => alphabet[byte & 31]).join('')}`
  }
  if (next.allowNameDisclosure === undefined) next.allowNameDisclosure = false
  resolvePublicIdentity(userId, next)
  return next
}

export function resolvePublicIdentity(userId, settings) {
  if (typeof userId !== 'string' || !userId) throw new Error('Invalid public profile owner')
  if (settings?.userId !== userId) throw new Error('Public profile owner mismatch')
  if (typeof settings.publicId !== 'string' || !/^[a-f0-9-]{36}$/.test(settings.publicId) || settings.publicId === userId ||
      typeof settings.publicAlias !== 'string' || !/^Автор-[0-9A-HJKMNP-TV-Z]{4}$/.test(settings.publicAlias) ||
      typeof settings.allowNameDisclosure !== 'boolean') throw new Error('Invalid public identity')
  const nickname = normalizePublicNickname(settings.publicNickname ?? '')
  const displayName = nickname || settings.publicAlias
  return Object.freeze({ nickname, alias: settings.publicAlias, publicId: settings.publicId, displayName,
    allowNameDisclosure: settings.allowNameDisclosure, displayLabel: displayName + (settings.allowNameDisclosure ? ' ›' : '') })
}
