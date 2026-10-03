import { maintenance } from '../runtime/maintenance.js'
import { captureBackup, validateBackup, restoreToNewDatabase, verifyRestoredDatabase } from './backup.js'
import { bytesHash } from '../utils/files.js'

const metadata = (file, backup, sha256) => ({ filename: file.name ?? null, byteSize: file.size,
  sha256, capturedAt: backup.capturedAt, origin: backup.origin, dbVersion: backup.databaseVersion,
  counts: Object.fromEntries(backup.stores.map(s => [s.name, s.count])) })

export async function createCheckpoint({ coordinator = maintenance, factory = indexedDB, origin = globalThis.location?.origin } = {}) {
  if (typeof origin !== 'string' || !origin) throw new Error('Checkpoint origin required')
  const state = coordinator.status()
  await coordinator.assertReady(state.token)
  const file = await captureBackup({ factory, origin, flush: () => coordinator.flushPending() })
  await coordinator.assertReady(state.token)
  const backup = await validateBackup(file), sha256 = await bytesHash(await file.arrayBuffer())
  return { file, receipt: { ...metadata(file, backup, sha256), maintenanceToken: state.token,
    checkpointId: crypto.randomUUID(), createdInMaintenance: true } }
}

export async function verifyCheckpointFromDisk(file, receipt, { coordinator = maintenance, factory = indexedDB } = {}) {
  await coordinator.assertReady(receipt.maintenanceToken)
  const sha256 = await bytesHash(await file.arrayBuffer())
  if (sha256 !== receipt.sha256 || file.size !== receipt.byteSize || !receipt.createdInMaintenance || !receipt.checkpointId) {
    throw new Error('Disk checkpoint differs from captured checkpoint')
  }
  const backup = await validateBackup(file)
  if (backup.origin !== receipt.origin || backup.databaseVersion !== receipt.dbVersion || backup.capturedAt !== receipt.capturedAt) {
    throw new Error('Checkpoint origin/version/time differs')
  }
  const name = await restoreToNewDatabase(file, { factory })
  const restored = await verifyRestoredDatabase(file, name, { factory })
  await coordinator.assertReady(receipt.maintenanceToken)
  return { ...metadata(file, backup, sha256), maintenanceToken: receipt.maintenanceToken,
    checkpointId: receipt.checkpointId, verifiedFromDisk: true, restoreVerified: restored.verified,
    isolatedRestoreName: name, isolatedRestoreDeleted: restored.deleted }
}
