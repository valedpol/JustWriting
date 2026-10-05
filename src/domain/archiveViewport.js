export function archiveDateTop(top, bottom, dateHeight) {
  return Math.min(Math.max(top, 0), bottom - dateHeight)
}

export function collapseAnchor(entries, activeId, viewportHeight) {
  if (!entries.length) return null
  const visible = entries.filter(entry => entry.bottom > 0 && entry.top < viewportHeight)
  const active = visible.find(entry => entry.textId === activeId)
  const candidates = visible.length ? visible : entries
  const nearest = candidates.reduce((best, entry) =>
    Math.abs((entry.top + entry.bottom) / 2 - viewportHeight / 2)
      < Math.abs((best.top + best.bottom) / 2 - viewportHeight / 2) ? entry : best)
  const entry = active ?? nearest
  return { textId: entry.textId, top: Math.max(0, Math.min(viewportHeight, entry.top)) }
}
