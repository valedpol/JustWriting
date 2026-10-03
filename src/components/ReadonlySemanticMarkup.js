import { createElement as h } from 'react'
import { CONTENT_FORMAT, CONTENT_VERSION, parseDocument } from '../editor/document.js'
import { parseSemanticMarkup } from '../editor/semanticSnapshot.js'

export default function ReadonlySemanticMarkup({ record }) {
  if (record.contentFormat !== CONTENT_FORMAT || record.contentVersion !== CONTENT_VERSION) return null
  try {
    const markup = parseSemanticMarkup(record.semanticMarkup, parseDocument(record.document).content.size)
    if (!markup.length) return null
    const titles = markup.filter(item => item.kind === 'title')
    const tags = [...new Set(markup.filter(item => item.kind === 'tag').map(item => item.value))]
    return h('div', { className: 'archive-semantic-markup', 'aria-label': 'Смысловая разметка' },
      titles.length ? h('div', { className: 'archive-semantic-titles' },
        titles.map((item, index) => h('span', { key: item.id, className: 'archive-semantic-title' }, `${index ? '  ' : ''}'${item.value}'`))) : null,
      tags.length ? h('div', { className: 'archive-semantic-tags' },
        tags.map(value => `#${value}`).join(' ')) : null)
  } catch {
    return h('div', { role: 'status', className: 'archive-semantic-markup' }, 'Не удалось прочитать смысловую разметку.')
  }
}
