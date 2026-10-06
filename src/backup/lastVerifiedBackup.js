// Account metadata only. No backup payload and no working IndexedDB writes.
export const LAST_VERIFIED_BACKUP_KEY = 'just-writing-last-verified-backup-v1'
const fields = ['capturedAt', 'filename', 'byteSize', 'sha256', 'dbVersion', 'origin',
  'isolatedRestoreName', 'restoreVerified', 'isolatedRestoreDeleted']

export function createLastVerifiedBackupStore(storage) {
  if (storage === undefined) {
    try { storage = globalThis.window?.localStorage } catch { /* Storage may be disabled by the browser. */ }
  }
  return {
    read() {
      try {
        const value = JSON.parse(storage?.getItem(LAST_VERIFIED_BACKUP_KEY) ?? 'null')
        return value?.restoreVerified === true && Number.isFinite(value.capturedAt) && value.counts ? value : null
      } catch { return null }
    },
    save(result, verifiedAt = Date.now()) {
      if (result.restoreVerified !== true || result.isolatedRestoreDeleted !== true) throw new Error('Проверка резервной копии не завершена.')
      const metadata = Object.fromEntries(fields.map(field => [field, result[field]]))
      metadata.counts = { ...result.counts }
      metadata.verifiedAt = verifiedAt
      if (!storage) throw new Error('Не удалось сохранить сведения о проверенной копии.')
      storage.setItem(LAST_VERIFIED_BACKUP_KEY, JSON.stringify(metadata))
      return metadata
    },
  }
}
