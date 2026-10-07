// Versioned storage contracts shared by migration and backup compatibility.
const index = (name, keyPath, unique = false) => ({ name, keyPath, unique, multiEntry: false })
const legacyStores = {
  settings: { keyPath: 'key', autoIncrement: false, indexes: [] },
  texts: { keyPath: 'textId', autoIncrement: false, indexes: [
    index('userDay', ['userId', 'dayKey'], true), index('userDayId', 'userDayId', true), index('userId', 'userId'),
  ] },
  userDays: { keyPath: 'userDayId', autoIncrement: false, indexes: [
    index('userDay', ['userId', 'dayKey'], true), index('userId', 'userId'),
  ] },
  wordCountSamples: { keyPath: 'sampleId', autoIncrement: false, indexes: [
    index('userDayTime', ['userDayId', 'timestamp'], true),
  ] },
}
const publications = { keyPath: 'publicationId', autoIncrement: false, indexes: [
  index('channelTime', ['channel', 'publishedAt']),
  index('userChannelTime', ['userId', 'channel', 'publishedAt']),
  index('userSource', ['userId', 'source.sourceType', 'source.sourceId']),
  index('sourceChannelRange', ['userId', 'source.sourceType', 'source.sourceId', 'source.range.from', 'source.range.to', 'channel'], true),
] }

export const DATABASE_VERSION = 5
export function databaseSchema(version) {
  if (version === 4) return { formatVersion: 1, stores: structuredClone(legacyStores) }
  if (version === 5) return { formatVersion: 2, stores: structuredClone({ ...legacyStores, publications }) }
  throw new Error('Unsupported database version')
}

export function createSchemaStore(db, name, definition) {
  const store = db.createObjectStore(name, { keyPath: definition.keyPath, autoIncrement: definition.autoIncrement })
  for (const entry of definition.indexes) store.createIndex(entry.name, entry.keyPath, { unique: entry.unique, multiEntry: entry.multiEntry })
  return store
}
