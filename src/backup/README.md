# Technical backup and isolated verification

Permanent infrastructure with an explicit Settings → Account → Data interface
and Console API; no automatic export, restore or maintenance entry. The application exposes `window.justWritingBackup` and
`window.justWritingMaintenance`. Every module URL within the tab uses the same
maintenance coordinator, including Console imports and Vite/HMR instances.
Each browser document has its own coordinator and shares origin-local Web Locks
and the explicit localStorage maintenance marker with other documents.

Backup format `just-writing-backup` supports version 1 / DB v4 (four stores),
version 2 / DB v5 (plus `publications`), and version 3 / DB v6 (plus
`publicationAnchors`). New v6 checkpoints use format v3; capturing an existing
v4/v5 database preserves its original format without
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

Checking an existing file validates its hashes and version-specific v4/v5/v6 structure, restores to a
fresh UUID database, reopens and compares it with that file. Only after exact
comparison does it upgrade that UUID copy to v6, check the resulting schema and
prove that all original keys/counts/values are unchanged. It never reads or
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

## Storage v6 and backward compatibility

The v4 → v5 upgrade created `publications`. The v5 → v6 upgrade adds an empty
`publicationAnchors` store and makes the historical `sourceChannelRange` index
non-unique. It does not rewrite any existing records or infer old anchors.
New publications and attached anchors are created atomically. Duplicate checks
use active attached live ranges in the repository transaction; detached and
missing anchors do not block creation. Mapping may legitimately converge ranges
and never makes an author's text save fail because of a range uniqueness index.

`../storage/databaseSchema.js` defines the supported v4/v5/v6 schema contracts.
Every backup snapshot uses one readonly transaction over all stores required by
its DB version, including all users and unknown publication fields. Unknown
versions, mismatched format/schema combinations and missing/extra stores fail.
User verification also checks exact key paths and indexes.

A v1/v4 or v2/v5 file is restored at its original version into a fresh UUID
database and compared exactly after reopen. Verification then migrates that
verified copy to v6, compares all original values and checks newly added stores
are empty. For v3/v6, anchors are part of the full exact comparison. The
maintenance fence remains in force for the working DB; the isolated verifier
uses only its session-registered UUID name. No restore targets the working DB.

Tests use isolated UUID names and fake IndexedDB only. Running this code
in the application will request schema v6 through the normal database open path;
the implementation and automated checks do not launch a working browser upgrade.
Existing publications stay readable as snapshots without guessed live anchors.
