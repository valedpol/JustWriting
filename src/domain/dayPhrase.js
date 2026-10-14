// One phrase per nonempty line; blank paragraph separators are ignored.
export function parseDayPhrases(markdown) {
  const phrases = markdown.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (phrases.length < 2 || new Set(phrases).size !== phrases.length) throw new Error('Invalid day phrase list')
  return phrases
}

export function selectDayPhrase(previous, { dayKey, authEventId = null, phrases, random = Math.random }) {
  const validIndex = index => Number.isInteger(index) && index >= 0 && index < phrases.length
  if (previous && (previous.version !== 1 || !validIndex(previous.selectedIndex) ||
    !Array.isArray(previous.remaining) || previous.remaining.some(index => !validIndex(index) || index === previous.selectedIndex) ||
    new Set(previous.remaining).size !== previous.remaining.length || typeof previous.dayKey !== 'string')) {
    throw new Error('Invalid saved day phrase queue')
  }
  const authenticated = authEventId !== null && authEventId !== previous?.lastAuthEventId
  // Clock rollback/stale calls must not consume the queue or undo a newer day.
  if (previous && dayKey <= previous.dayKey && !authenticated) return previous
  let remaining = previous ? [...previous.remaining] : []
  if (!remaining.length) {
    remaining = phrases.map((_, index) => index)
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[remaining[i], remaining[j]] = [remaining[j], remaining[i]]
    }
    if (remaining[0] === previous?.selectedIndex) {
      const j = 1 + Math.floor(random() * (remaining.length - 1))
      ;[remaining[0], remaining[j]] = [remaining[j], remaining[0]]
    }
  }
  const selectedIndex = remaining.shift()
  return { ...previous, version: 1, dayKey: previous && previous.dayKey > dayKey ? previous.dayKey : dayKey,
    selectedIndex, remaining, lastAuthEventId: authEventId ?? previous?.lastAuthEventId ?? null }
}
