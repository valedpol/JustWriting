import { createElement as h } from 'react'
import { documentFromRecord, isDocumentEmpty } from '../editor/document.js'

function renderNode(node, key) {
  if (node.type === 'text') return (node.marks ?? []).reduce((child, mark) =>
    h({ bold: 'strong', italic: 'em', underline: 'u' }[mark.type], { key }, child), node.text)
  if (node.type === 'hardBreak') return h('br', { key })
  if (node.type === 'horizontalRule') return h('hr', { key })
  return h('p', { key }, node.content?.length ? node.content.map(renderNode) : h('br'))
}

export default function ReadonlyDocument({ record }) {
  if (record.contentFormat === undefined) return record.content || 'Текст пуст.'
  try {
    const document = documentFromRecord(record)
    return h('div', { className: 'readonly-document' }, isDocumentEmpty(document) ? 'Текст пуст.' : document.content.map(renderNode))
  } catch {
    return h('div', null,
      h('p', { role: 'status' }, 'Не удалось отобразить форматирование. Показана сохранённая текстовая версия.'),
      record.content || 'Текст пуст.')
  }
}
