import { transaction } from './database.js'
import { archiveDocument } from '../editor/archiveDocument.js'
import { CONTENT_FORMAT, CONTENT_VERSION, parseDocument } from '../editor/document.js'
import { parseSemanticMarkup } from '../editor/semanticSnapshot.js'

// This path cannot accept author text, formatting, day or session changes.
export function saveSemanticMarkup(userId, previous, markup) {
  const submitted = structuredClone(markup)
  return transaction(['texts'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('texts')
    const request = store.get(previous.textId)
    request.onsuccess = () => {
      try {
        const current = request.result
        if (!current || current.userId !== userId || previous.userId !== userId) throw new Error('Запись недоступна этому пользователю.')
        if (current.revision !== previous.revision) throw new Error('Запись изменена в другой вкладке. Обновите архив перед назначением разметки.')
        const document = archiveDocument(current)
        const semanticMarkup = parseSemanticMarkup(submitted, parseDocument(document).content.size)
        if (JSON.stringify(semanticMarkup) === JSON.stringify(current.semanticMarkup ?? [])) { done(current); return }
        const record = { ...current, semanticMarkup, revision: (current.revision ?? 0) + 1 }
        if (current.contentFormat === undefined) Object.assign(record, { contentFormat: CONTENT_FORMAT, contentVersion: CONTENT_VERSION, document })
        store.put(record)
        done(record)
      } catch (error) { fail(error) }
    }
  })
}
