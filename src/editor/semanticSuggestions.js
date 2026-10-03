export function semanticSuggestions(records, userId, kind, query = '') {
  const values = new Map()
  for (const record of records) {
    if (record.userId !== userId) continue
    for (const item of record.semanticMarkup ?? []) {
      if (item.kind !== kind || typeof item.value !== 'string') continue
      const key = item.value
      const previous = values.get(key) ?? { value: item.value, valueId: item.valueId, count: 0, lastUsed: 0 }
      previous.count++
      previous.lastUsed = Math.max(previous.lastUsed, item.assignedAt ?? record.updatedAt ?? 0)
      values.set(key, previous)
    }
  }
  const all = [...values.values()].sort((a, b) => b.lastUsed - a.lastUsed || a.value.localeCompare(b.value))
  const latest = all.shift()
  all.sort((a, b) => b.count - a.count || b.lastUsed - a.lastUsed || a.value.localeCompare(b.value))
  return (latest ? [latest, ...all] : all).filter(item => item.value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
}
