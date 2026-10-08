import { initializePublicIdentity } from '../domain/publicIdentity.js'
import { legacyToDocument, parseDocument } from '../editor/document.js'
import { createPublicationRepository } from '../storage/publicationRepository.js'
import { createPublicIdentityRepository } from '../storage/publicIdentityRepository.js'

// Explicit isolated runner required. Nothing seeds or opens a database on import.
export async function createReaderFeedFixture({ runTransaction } = {}) {
  if (typeof runTransaction !== 'function') throw new Error('An isolated fixture transaction runner is required')
  const users = ['private-fixture-a', 'private-fixture-b', 'private-fixture-c']
  const profiles = users.map((userId, i) => ({ key: 'localProfile', userId, displayName: `Current fixture name ${i}` }))
  const publicProfiles = users.map((userId, i) => ({ ...initializePublicIdentity(userId), key: `publicProfile:${userId}`,
    publicNickname: i === 0 ? 'Mumipol' : i === 2 ? 'Third' : '', allowNameDisclosure: i !== 1, authorVisibility: 'visible' }))
  const texts = users.map((userId, i) => {
    const content = `alpha beta gamma ${i}`
    const document = legacyToDocument(content)
    document.content[0].content[0].marks = [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }]
    return { userId, textId: `private-source-${i}`, userDayId: `private-day-${i}`, dayKey: '2026-10-07', revision: 1,
      content, document, contentFormat: 'tiptap-json', contentVersion: 1, semanticMarkup: [
        { id: 'private-tag', valueId: 'private-tag', kind: 'tag', value: 'PRIVATE TAG', source: 'selection', direction: 'backward', anchor: 1, range: { from: 1, to: 6 } },
        ...(i === 0 ? [{ id: 'title', valueId: 'title', kind: 'title', value: 'Snapshot title', source: 'selection', direction: 'forward', anchor: 1, range: { from: 1, to: parseDocument(document).content.size - 1 } }] : []),
      ] }
  })
  await runTransaction(['settings', 'texts', 'userDays'], 'readwrite', tx => {
    publicProfiles.forEach(profile => tx.objectStore('settings').put(profile))
    texts.forEach(text => {
      tx.objectStore('texts').put(text)
      tx.objectStore('userDays').put({ userId: text.userId, userDayId: text.userDayId, dayKey: text.dayKey, revision: 1 })
    })
  })
  let timestamp = 0, nextId = 0
  const repo = createPublicationRepository({ runTransaction, flush: async () => {}, now: () => timestamp, id: () => `fixture-publication-${++nextId}` })
  const source = (i, range) => ({ sourceType: 'archive', sourceId: texts[i].textId, sourceRevision: 1, coordinateVersion: 1,
    archive: { userDayId: texts[i].userDayId, dayKey: texts[i].dayKey }, range: range ?? { from: 0, to: parseDocument(texts[i].document).content.size } })
  const records = []
  for (let i = 0; i < 3; i++) {
    await runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ ...profiles[i], displayName: `HISTORICAL NAME ${i}` }))
    timestamp = i === 2 ? 300 : 200
    records.push(...await repo.createPublications(users[i], { source: source(i), channels: i === 0 ? ['profile', 'feed', 'internet'] : ['feed'] }))
    if (i === 0) {
      timestamp = 300
      records.push(...await repo.createPublications(users[i], { source: source(i, { from: 1, to: 6 }), channels: ['feed'] }))
      await runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put({ ...publicProfiles[i], authorVisibility: 'hidden' }))
      timestamp = 400
      records.push(...await repo.createPublications(users[i], { source: source(i, { from: 6, to: 11 }), channels: ['feed'] }))
      await runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put(publicProfiles[i]))
    }
  }
  await runTransaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put(profiles[0]))
  const currentNames = new Map(profiles.map(profile => [profile.userId, profile.displayName]))
  const identityRepo = createPublicIdentityRepository({ runTransaction, authorProfileProvider: async userId => currentNames.get(userId) ?? null })
  const api = { list: userId => repo.listReaderFeedPublications(userId), name: publicId => identityRepo.loadDisclosedAuthorName(publicId), remove: (userId, publicationId) => repo.deletePublication(userId, publicationId) }
  return { users, profiles, publicProfiles, texts, records, currentNames, identityRepo, repo, api }
}
