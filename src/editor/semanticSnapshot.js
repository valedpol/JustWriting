// Validate persisted data only. Editing, mapping and history belong to later stages.
export function parseSemanticMarkup(markup, documentSize) {
  if (!Array.isArray(markup)) throw new Error('Некорректная смысловая разметка')
  const ids = new Set()
  const position = value => Number.isInteger(value) && value >= 0 && value <= documentSize
  for (const item of markup) {
    if (!item || typeof item !== 'object' ||
      !['id', 'valueId', 'value'].every(key => typeof item[key] === 'string' && item[key].trim()) ||
      ids.has(item.id) || !['tag', 'title'].includes(item.kind) ||
      !['selection', 'slash'].includes(item.source) ||
      item.direction !== (item.kind === 'title' ? 'forward' : 'backward') ||
      !position(item.anchor) ||
      (item.assignedAt !== undefined && (!Number.isFinite(item.assignedAt) || item.assignedAt < 0))) {
      throw new Error('Некорректная смысловая разметка')
    }
    if (item.range === null) {
      if (item.source !== 'slash') throw new Error('Для выделения требуется диапазон')
    } else if (!item.range || !position(item.range.from) || !position(item.range.to) || item.range.from >= item.range.to) {
      throw new Error('Некорректный смысловой диапазон')
    }
    ids.add(item.id)
  }
  return structuredClone(markup)
}
