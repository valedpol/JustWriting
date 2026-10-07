# Technical backup and isolated verification

Permanent infrastructure with an explicit Settings → Account → Data interface
and Console API; no automatic export, restore or maintenance entry. The application exposes `window.justWritingBackup` and
`window.justWritingMaintenance`. Every module URL within the tab uses the same
maintenance coordinator, including Console imports and Vite/HMR instances.
Each browser document has its own coordinator and shares origin-local Web Locks
and the explicit localStorage maintenance marker with other documents.

Backup format `just-writing-backup` supports version 1 / DB v4 (four stores)
and version 2 / DB v5 (the same stores plus `publications`). New v5 checkpoints
use format v2; capturing an existing v4 database preserves format v1 without
upgrading it. It preserves all users, schema/indexes, primary keys,
counts, DB version, origin, capture timestamp, unknown fields, missing/null and
supported structured-clone values. Tagged graph encoding handles cycles/shared
references, dates, bigint, special numbers, buffers/views, maps/sets and blobs.
Unsupported values fail rather than being coerced by JSON. Store/envelope SHA-256
is checked by rereading the generated file.

There are no historical source hashes, calendar dates, profile requirements or
fixed localhost assumptions. Existing schema/data are captured as they are;
backup verification never recalculates saved day boundaries or policy.

## User interface

Settings → Account → Data contains “Создать резервную копию” and
“Проверить резервную копию”. Creation requires a ready writer with no active
IME, pending save or save error. It enters maintenance, flushes the live
controllers and captures a checkpoint. Download alone never means verified.
Choose the saved file with the regular file input; its bytes must match the
checkpoint, then UUID restore/reopen/full comparison must pass. Success exits
the owned maintenance session and displays “Резервная копия проверена”.

Checking an existing file validates its hashes and version-specific v4/v5 structure, restores to a
fresh UUID database, reopens and compares it with that file. It never reads or
compares the current working database. No working restore writer exists.
Other origins are recorded as metadata, not silently rewritten.

Cancelling the picker or explicitly returning to work exits owned maintenance
without declaring verification success. Flush/restore failures never silently
release maintenance; use “Вернуться к работе без проверки” in the owner tab.
If a failed restore leaves a UUID database, preserve it for diagnosis; never
delete or clear the working database. The exact filename, bytes, SHA-256,
capture time, origin, DB version and counts are available in technical details.

The Account retains “Последняя проверенная копия” with creation date and text
count, and collapsed technical details. Only a successful UUID restore/reopen
and deletion replaces this receipt; downloads, cancellations and failures keep
the previous receipt. Creation and verification times, filename, byte size,
SHA-256, version, origin, counts and UUID verification results are stored under
`just-writing-last-verified-backup-v1` in origin-local localStorage. No file or
backup payload is stored there, and no working IndexedDB write/schema change is
needed. The receipt survives reloads and browser restarts in the same profile;
clearing site data removes it. Research does not consume it yet.

## Console checkpoint procedure

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

## Storage v5 compatibility

The application schema upgrade v4 → v5 only creates `publications` and its
indexes. It does not traverse, transform or rewrite the four existing stores.
Publications have a `publicationId` key and indexes for owner/channel/time,
reader channel/time, source lookup and unique owner/source-type/source-ID/range/
channel identity. No publication writer or UI is introduced in this storage stage.

`../storage/databaseSchema.js` defines the supported v4/v5 schema contracts.
Every backup snapshot uses one readonly transaction over all stores required by
its DB version, including all users and unknown publication fields. Unknown
versions, mismatched format/schema combinations and missing/extra stores fail.
User verification also checks exact key paths and indexes.

A v1/v4 file is restored at version 4 into a fresh UUID database and compared
exactly after reopen, without migration. A separate isolated migration test
then upgrades that verified v4 copy to v5 and compares the old stores again,
requiring an empty `publications` store. The exact restore proof and the upgrade
proof are independent. No restore targets the working database.

Stage A tests use isolated UUID names and fake IndexedDB only. Running this code
in the application will request schema v5 through the normal database open path;
the implementation and automated checks do not launch a working browser upgrade.
Publication domain validation and repository/UI belong to the next stage.
