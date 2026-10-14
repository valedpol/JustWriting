// Local Account metadata, independent of verification receipts and backup payloads.
export const CREATED_BACKUP_COUNT_KEY = 'just-writing-created-backup-count-v1'

export function createCreatedBackupCountStore(storage) {
  if (storage === undefined) {
    try { storage = globalThis.window?.localStorage } catch { /* Browser storage may be disabled. */ }
  }
  const read = () => {
    if (!storage) throw new Error('Не удалось прочитать счётчик резервных копий.')
    const raw = storage.getItem(CREATED_BACKUP_COUNT_KEY)
    if (raw === null) return 0
    const count = JSON.parse(raw)
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Некорректный счётчик резервных копий.')
    return count
  }
  return {
    read,
    increment() {
      const count = read() + 1
      if (!Number.isSafeInteger(count)) throw new Error('Счётчик резервных копий переполнен.')
      storage.setItem(CREATED_BACKUP_COUNT_KEY, JSON.stringify(count))
      return count
    },
  }
}
