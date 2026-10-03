import { createCheckpoint, verifyCheckpointFromDisk } from './backup/checkpoint.js'
import { maintenance } from './runtime/maintenance.js'
import { captureBackup, validateBackup, restoreToNewDatabase, verifyRestoredDatabase } from './backup/backup.js'
import { bytesHash, downloadFile } from './utils/files.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Backlog from './Backlog.jsx'

// Technical console API only; no automatic backup or restore.
window.justWritingBackup = Object.freeze({ captureBackup, validateBackup, restoreToNewDatabase, verifyRestoredDatabase,
  createCheckpoint, verifyCheckpointFromDisk, bytesHash, downloadFile })

// Presence lease prevents a second application startup during explicit maintenance.
await maintenance.registerApplication()
window.justWritingMaintenance = Object.freeze({ enter: () => maintenance.enter(), exit: () => maintenance.exit(), status: () => maintenance.status(), assertReady: token => maintenance.assertReady(token) })

const page = window.location.pathname === '/backlog' || window.location.pathname === '/backlog/'
  ? <Backlog />
  : <App />

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {page}
  </StrictMode>,
)
