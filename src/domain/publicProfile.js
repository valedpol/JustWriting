// Public settings and provider payloads are allowlisted before reaching readers.
export function publicProfileField(field, value) {
  if (field === 'pinnedPublicationId') {
    if (value !== null && (typeof value !== 'string' || !value.trim())) throw new Error('Некорректная закреплённая публикация.')
    return value
  }
  if (field === 'profileVisible') {
    if (typeof value !== 'boolean') throw new Error('Доступность профиля должна быть boolean.')
    return value
  }
  if (field === 'about') {
    if (typeof value !== 'string' || Array.from(value).length > 300) throw new Error('О себе — не более 300 символов.')
    return value
  }
  if (field === 'links') {
    if (!Array.isArray(value)) throw new Error('Публичные ссылки должны быть списком.')
    return value.map(link => {
      if (typeof link?.label !== 'string' || !link.label.trim() || typeof link.url !== 'string') throw new Error('Укажи название и URL ссылки.')
      let url
      try { url = new URL(link.url.trim()) } catch { throw new Error('Укажи безопасный URL https://.') }
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('Укажи безопасный URL https://.')
      return Object.freeze({ label: link.label.trim(), url: url.href })
    })
  }
  throw new Error('Invalid public profile setting')
}
export function publicProfileDetails(settings) {
  return { profileVisible: publicProfileField('profileVisible', settings.profileVisible ?? false),
    about: publicProfileField('about', settings.about ?? ''), links: Object.freeze(publicProfileField('links', settings.links ?? [])),
    pinnedPublicationId: publicProfileField('pinnedPublicationId', settings.pinnedPublicationId ?? null) }
}
export function publicAuthorStats(value) {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(value.writingDays) || value.writingDays < 0 || !Number.isSafeInteger(value.totalWords) || value.totalWords < 0) throw new Error('Invalid public author statistics')
  const joinedAt = typeof value.joinedAt === 'number' && Number.isFinite(value.joinedAt) && !Number.isNaN(new Date(value.joinedAt).getTime()) ? value.joinedAt : null
  return Object.freeze({ joinedAt, writingDays: value.writingDays, totalWords: value.totalWords })
}
