# Publications v1 — model and repository (stage B)

The v5 store and its unique index were added in stage A. These APIs perform ordinary fenced
application transactions and cannot write while maintenance is active.

## API

`createPublications(userId, { source, channels })` resolves after commit with
independent, deeply frozen publication records. There is no update API.

```js
source = {
  sourceType: 'archive',
  sourceId: text.textId,
  sourceRevision: text.revision,
  coordinateVersion: 1,
  range: { from, to }, // ProseMirror UTF-16 positions, not string offsets
  archive: { userDayId: text.userDayId, dayKey: text.dayKey },
}
channels = ['profile', 'feed', 'internet'] // nonempty, unique subset
```

The adapter flushes the registered application queues before rereading the text
and its userDay. A caller can provide its source-specific `flush` via the factory
(e.g. archive controller.flush). Missing live flush, failed flush, stale revision,
owner/identity mismatch, invalid coordinates or inconsistent content/document
stop before publication writes. After flush, callers must submit the confirmed
saved revision rather than silently publish a changed selection.

The final transaction rereads text/day, verifies the source fingerprint and
revision, reads author/settings, then uses `add` for all channels. Any conflict
aborts the entire transaction. Its only mutations are in `publications`; it
never puts/deletes source texts, userDays, samples or settings. Source type is
part of the unique index; v1's archive adapter rejects other types. A future
project adapter can reuse the identity without conflating project and archive.

Canonicalization changes only outer document selection boundaries to equivalent
textblock boundaries, never whitespace or content. Snapshot content is sliced
from the original content string, including CRLF/CR. The coordinate map verifies
that the rich document represents that string; inconsistent records are rejected.
Snapshot document retains the selected structure and B/I/U. Source hashes are
SHA-256 of UTF-8 original content and JSON.stringify of the parsed archive
presentation document. They refer to the complete source at publication time.
No semantic markup, tags, selection state or unknown source fields are copied.
One distinct completed title value inherits only on exact canonical range
match; multiple different matching values yield no title.

`listOwnPublications(userId, channel)` returns immutable owner records, sorted
by publishedAt descending and publicationId ascending (codepoint order).

`listFeedPublications()` has no current-user argument. It returns all feed
records in the same stable order as a public reader projection: snapshot,
publicationId, channel, publishedAt and authorVisibility. It exposes an author
only when visibility is visible, and never exposes source/provenance or private
owner payload. It does not read source/settings for rendering snapshots.

`deletePublication(userId, publicationId)` deletes exactly one existing owned
record, after checking ownership in the same transaction. Missing/foreign IDs
reject. Republish is a new record/ID/time; no ghost, undo or source mutation.

Feed/Internet author snapshot is read from `settings.localProfile` (matching
userId required), with displayName preserved at publication time. Profile has
neither author nor authorVisibility: its identity comes from the profile page.
The future public-profile settings record is keyed `publicProfile:${userId}`,
with `userId` and `authorVisibility: 'visible' | 'hidden'`. Absent visibility
reads as visible; no defaults or settings records are written here. UI and
settings editing are deferred to later stages.

Factories accept a transaction runner, flush, clock and ID generator for
isolated tests. Default exports use the existing storage/maintenance boundary.
No module opens IndexedDB or runs creation on import. Immutability is an API
contract, not protection from direct DevTools writes to IndexedDB.

Tests use only independent fake IndexedDB UUID databases, including fixtures for
three userIds, concurrency conflicts, multi-channel rollback, source preservation,
full reopen and backup v2 restore/reopen/compare of repository-created records.

## Owner libraries (stage D)

Archive navigation opens the first nonempty own channel (Profile, Feed, Internet).
When all are empty it opens Profile with the general empty message; explicitly
selecting a channel uses its channel empty message. Back returns directly to the
preserved archive; Publications is a navigation group, not a separate root view.
Channel counts and published word totals derive from stored owner snapshots.
Cards start collapsed, show measured first/last three visual lines, and expand
the saved B/I/U snapshot without reading the current source. Writing date uses
the captured archive dayKey; the right rail uses publishedAt. Confirmed removal
delegates to the existing owner-safe delete API and never changes source data.

## Deferred owner-view UX

After functional acceptance of stage D, consider a subtly distinct reading
presentation for published snapshots: this is a space for showing texts, apart
from writing or revisiting the archive. No new visual style is decided here.
