import { transaction } from './database.js'
import { archiveDocument } from '../editor/archiveDocument.js'
import { CONTENT_FORMAT, CONTENT_VERSION, parseDocument } from '../editor/document.js'
import { assertArchiveTransaction } from '../editor/archivePresentation.js'
import { parseSemanticMarkup } from '../editor/semanticSnapshot.js'

// Only one existing text record; content and all unrelated fields come from DB.
export function saveArchivePresentation(userId, previous, tr) {
  return transaction(['texts'], 'readwrite', (tx, done, fail) => {
    const store = tx.objectStore('texts')
    const request = store.get(previous.textId)
    request.onsuccess = () => {
      try {
        const current = request.result
        if (!current || current.userId !== userId || previous.userId !== userId) throw new Error('Запись недоступна этому пользователю.')
        if (current.revision !== previous.revision) throw new Error('Запись изменена в другой вкладке. Обновите архив.')
        const before = parseDocument(archiveDocument(current))
        if (!tr.before.eq(before)) throw new Error('Устаревший архивный документ.')
        const document = parseDocument(tr.doc.toJSON()).toJSON()
        const semanticMarkup = parseSemanticMarkup(assertArchiveTransaction(tr, current.semanticMarkup ?? []), before.content.size)
        const markupChanged = JSON.stringify(semanticMarkup) !== JSON.stringify(current.semanticMarkup ?? [])
        if (before.eq(tr.doc) && !markupChanged) { done(current); return }
        const record = { ...current, document, ...(markupChanged ? { semanticMarkup } : {}), contentFormat: CONTENT_FORMAT,
          contentVersion: CONTENT_VERSION, revision: (current.revision ?? 0) + 1 }
        store.put(record)
        done(record)
      } catch (error) { fail(error) }
    }
  })
}
