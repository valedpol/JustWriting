import { maintenance } from '../runtime/maintenance.js'
import { createCheckpoint, verifyCheckpointFromDisk } from './checkpoint.js'
import { validateBackup, restoreToNewDatabase, verifyRestoredDatabase } from './backup.js'
import { bytesHash } from '../utils/files.js'
import { parseDocument } from '../editor/document.js'
import { parseSemanticMarkup } from '../editor/semanticSnapshot.js'

import { databaseSchema } from '../storage/databaseSchema.js'

export function assertBackupWriterReady(controller, status) {
  if (!controller || controller.composing || ['saving', 'error', 'loading', 'load-error'].includes(status) ||
    ['saving', 'error'].includes(controller.snapshot.status)) throw new Error('Завершите ввод и дождитесь успешного сохранения текста.')
}

export function assertCompatibleBackup(data) {
  const schema = databaseSchema(data.databaseVersion).stores
  if (data.stores.length !== Object.keys(schema).length) throw new Error('Структура резервной копии несовместима с JW.')
  if (!Number.isFinite(data.capturedAt) || !Number.isFinite(new Date(data.capturedAt).getTime())) throw new Error('Некорректная дата создания резервной копии.')
  const rows = {}
  for (const store of data.stores) {
    const expected = schema[store.name]
    if (!expected || store.keyPath !== expected.keyPath || store.autoIncrement !== expected.autoIncrement ||
      JSON.stringify([...store.indexes].sort((a, b) => a.name.localeCompare(b.name))
        .map(i => ({ name: i.name, keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry }))) !==
      JSON.stringify([...expected.indexes].sort((a, b) => a.name.localeCompare(b.name)))) throw new Error('Структура резервной копии несовместима с JW.')
    rows[store.name] = store.records.map(record => {
      if (!record.value || typeof record.key !== 'string' || record.value[store.keyPath] !== record.key) throw new Error('Некорректные ключи записей резервной копии.')
      return record.value
    })
  }
  const days = new Map(rows.userDays.map(day => [day.userDayId, day]))
  for (const text of rows.texts) {
    const day = days.get(text.userDayId)
    if (!day || day.userId !== text.userId || day.dayKey !== text.dayKey || typeof text.content !== 'string') throw new Error('Нарушены связи текста и дня.')
    if (text.contentFormat !== undefined) {
      if (text.contentFormat !== 'tiptap-json' || text.contentVersion !== 1) throw new Error('Неподдерживаемый формат текста.')
      const document = parseDocument(text.document)
      parseSemanticMarkup(text.semanticMarkup, document.content.size)
    }
  }
  for (const sample of rows.wordCountSamples) {
    const day = days.get(sample.userDayId)
    if (!day || day.userId !== sample.userId || day.dayKey !== sample.dayKey || !Number.isFinite(sample.timestamp) || !Number.isFinite(sample.wordCount)) throw new Error('Некорректные наблюдения количества слов.')
  }
}

export function createUserBackupService({ coordinator = maintenance, factory = globalThis.indexedDB,
  origin = globalThis.location?.origin } = {}) {
  return {
    status: () => coordinator.status(),
    resume: () => coordinator.exit(),
    async create(assertCanCreate = () => {}) {
      assertCanCreate()
      if (coordinator.status().localPhase !== 'normal' || coordinator.status().pendingWrites) throw new Error('Дождитесь завершения сохранения и завершите ввод перед созданием копии.')
      await coordinator.enter()
      const captured = await createCheckpoint({ coordinator, factory, origin })
      assertCompatibleBackup(await validateBackup(captured.file))
      return captured
    },
    async verify(file, receipt = null) {
      const data = await validateBackup(file)
      assertCompatibleBackup(data)
      if (receipt) {
        const result = await verifyCheckpointFromDisk(file, receipt, { coordinator, factory })
        await coordinator.exit()
        return result
      }
      // An existing file is checked against itself. Never open the working DB.
      const name = await restoreToNewDatabase(file, { factory })
      const restored = await verifyRestoredDatabase(file, name, { factory })
      return { filename: file.name, byteSize: file.size, sha256: await bytesHash(await file.arrayBuffer()),
        capturedAt: data.capturedAt, origin: data.origin, dbVersion: data.databaseVersion,
        formatVersion: databaseSchema(data.databaseVersion).formatVersion,
        counts: restored.counts, verifiedFromDisk: true, restoreVerified: restored.verified,
        isolatedRestoreName: name, isolatedRestoreDeleted: restored.deleted }
    },
  }
}
