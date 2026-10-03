# Technical backup and isolated verification

Permanent Console-only infrastructure; no automatic export, restore or
maintenance entry. The application exposes `window.justWritingBackup` and
`window.justWritingMaintenance`. Every module URL within the tab uses the same
maintenance coordinator, including Console imports and Vite/HMR instances.
Each browser document has its own coordinator and shares origin-local Web Locks
and the explicit localStorage maintenance marker with other documents.

Backup format `just-writing-backup`, version 1, remains compatible with earlier
files. It preserves all four stores, all users, schema/indexes, primary keys,
counts, DB version, origin, capture timestamp, unknown fields, missing/null and
supported structured-clone values. Tagged graph encoding handles cycles/shared
references, dates, bigint, special numbers, buffers/views, maps/sets and blobs.
Unsupported values fail rather than being coerced by JSON. Store/envelope SHA-256
is checked by rereading the generated file.

There are no historical source hashes, calendar dates, profile requirements or
fixed localhost assumptions. Existing schema/data are captured as they are;
backup verification never recalculates saved day boundaries or policy.

## Checkpoint procedure

Use one ready application tab, finish IME/input and close other application tabs.
Keep the owner tab open during maintenance; do not reload/edit source/restart
Vite. Other documents cannot start ordinary writes while the marker/fence is
held. Any failure means STOP; never delete a marker manually. Explicit owner exit
is required to resume normal operation. Web Locks/localStorage are required.

Execute each block separately and inspect its result.

```js
var backupAPI = window.justWritingBackup;
var checkpointMaintenance = await window.justWritingMaintenance.enter();
console.log(checkpointMaintenance);
```

Require active maintenance, localPhase maintenance and pendingWrites 0.

```js
var capturedCheckpoint = await backupAPI.createCheckpoint();
var checkpointDownload = backupAPI.downloadFile(capturedCheckpoint.file,
  'just-writing-checkpoint-' + Date.now() + '.json');
console.log({ ...capturedCheckpoint.receipt, filename: checkpointDownload.filename });
```

This waits for real registered editor/archive flush callbacks, captures one
readonly transaction, closes its connection, and validates the resulting file.

After download completes, choose the exact new file from disk:

```js
URL.revokeObjectURL(checkpointDownload.url);
var [checkpointHandle] = await window.showOpenFilePicker();
var checkpointFile = await checkpointHandle.getFile();
var checkpointVerification = await backupAPI.verifyCheckpointFromDisk(
  checkpointFile, capturedCheckpoint.receipt);
console.log(checkpointVerification);
```

Require verifiedFromDisk/restoreVerified/isolatedRestoreDeleted true and inspect
filename, byteSize, SHA-256, capturedAt, origin, dbVersion and all store counts.
Disk bytes must match the captured receipt. Restore creates a fresh UUID database
using add, closes/reopens it and compares full schema/keys/counts/values with the
backup. Only the successfully verified UUID database is deleted. There is no
working restore API, clear or delete of the working database.

After successful verification and saving the file, explicitly resume normal mode:

```js
console.log(await window.justWritingMaintenance.exit());
```

Require normal/localPhase normal, active false, pendingWrites 0 and
producersBlocked false. A failed transition stays blocked until explicit exit;
a lost owner must be diagnosed rather than wiping the marker.

## Internal modules

- backup.js: readonly snapshot, backup validation, UUID-only restore/verification,
  application flush registration (shared coordinator, not module-local queues).
- backupCodec.js: lossless structured graph and canonical value identity.
- checkpoint.js: owner-bound fresh checkpoint and disk-file verification.
- ../utils/files.js: exact-byte SHA-256 and explicit download helper; caller owns
  URL revocation.
- ../runtime/maintenance.js: producer blocking, accepted-write drain, presence
  lease, write fence, owner assertion and per-realm singleton.

Tests use in-memory storage/Web Locks and fake IndexedDB. The singleton regression
imports distinct query URLs to reproduce the Console module-instance problem.
No test opens the real browser database or requires private migration files.
