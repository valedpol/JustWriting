import { getSchema } from '@tiptap/core'
import { extensions } from './schema.js'

export const CONTENT_FORMAT = 'tiptap-json'
export const CONTENT_VERSION = 1
const schema = getSchema(extensions)

// Reject unsupported fields instead of silently stripping user data.
function checkJSON(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Некорректный документ')
  const fields = node.type === 'text' ? ['type', 'text', 'marks'] : ['type', 'content', 'marks']
  if (Object.keys(node).some(key => !fields.includes(key))) throw new Error('Неподдерживаемые поля документа')
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) throw new Error('Некорректные marks')
    for (const mark of node.marks) {
      if (!mark || !['bold', 'italic', 'underline'].includes(mark.type) || Object.keys(mark).some(key => key !== 'type')) throw new Error('Неподдерживаемое форматирование')
    }
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) throw new Error('Некорректное содержимое документа')
    node.content.forEach(checkJSON)
  }
}

export function parseDocument(document) {
  checkJSON(document)
  const node = schema.nodeFromJSON(document)
  if (node.type !== schema.topNodeType) throw new Error('Ожидался корневой doc')
  node.check()
  return node
}

export function legacyToDocument(content) {
  if (typeof content !== 'string') throw new Error('Ожидался plain text')
  return {
    type: 'doc',
    content: content.replace(/\r\n?/g, '\n').split('\n').map(text => ({
      type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}),
    })),
  }
}

export function documentToContent(document) {
  const doc = parseDocument(document)
  const blocks = []
  doc.forEach(block => {
    let text = ''
    block.forEach(node => { text += node.isText ? node.text : node.type.name === 'hardBreak' ? '\n' : '' })
    blocks.push(text)
  })
  return blocks.join('\n')
}

export function isDocumentEmpty(document) {
  const doc = parseDocument(document)
  let hasContent = false
  doc.descendants(node => {
    if (node.type.name === 'horizontalRule' || (node.isText && node.text.trim())) hasContent = true
  })
  return !hasContent
}

// Pure read adapter: opening a legacy record never writes or increments revision.
export function documentFromRecord(record) {
  if (!record) return legacyToDocument('')
  if (record.contentFormat === undefined) return legacyToDocument(record.content)
  if (record.contentFormat !== CONTENT_FORMAT || record.contentVersion !== CONTENT_VERSION) {
    throw new Error('Неподдерживаемая версия документа')
  }
  return parseDocument(record.document).toJSON()
}
