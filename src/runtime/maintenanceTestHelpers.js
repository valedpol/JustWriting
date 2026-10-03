// In-memory Web Locks/storage adapters for UUID-only tests, never browser state.
export function memoryStorage() {
  const data = new Map()
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }
}
export function memoryLocks({ beforeRelease = async () => {} } = {}) {
  const held = []
  return {
    async request(name, { mode }, callback) {
      await Promise.resolve()
      if (held.some(l => l.name === name && (l.mode === 'exclusive' || mode === 'exclusive'))) return callback(null)
      const lock = { name, mode }; held.push(lock)
      try { return await callback(lock) } finally {
        await beforeRelease(lock)
        held.splice(held.indexOf(lock), 1)
      }
    },
    async query() { return { held: [...held], pending: [] } },
  }
}
