# Publications v1 — model and repository (stage B)

The v5 store was added in stage A; v6 separates mutable live anchors from
immutable historical publication records. These APIs perform ordinary fenced
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
aborts the entire transaction. Creation writes only `publications` and
`publicationAnchors`; it never puts/deletes source texts, userDays, samples or
settings. Source type is part of the live identity; v1's archive adapter rejects other types. A future
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
owner payload. Snapshot content never reads current source. Public author names
resolve from current public-profile settings through the shared identity repository.
Missing identity fields are initialized once in a maintenance-fenced settings-only
transaction; subsequent reads are readonly. Publication objects are never rewritten.

`deletePublication(userId, publicationId)` deletes exactly one existing owned
record and its anchor, after checking ownership in the same transaction. Missing/foreign IDs
reject. Republish is a new record/ID/time; no ghost, undo or source mutation.

Feed/Internet legacy private author metadata is read from `settings.localProfile`
(matching userId required), but its internal name/ID are never reader fields. Profile has
neither author nor authorVisibility: its identity comes from the profile page.
The public-profile settings record is keyed `publicProfile:${userId}`,
with `userId`, `authorVisibility: 'visible' | 'hidden'`, optional `publicNickname`,
random `publicId`, random `publicAlias` (e.g. `Автор-7K3M`) and boolean
`allowNameDisclosure` (default false). Initialization preserves all existing fields
and re-reads inside the write transaction to serialize concurrent first loads.
Absent visibility reads as visible; visibility is captured only for new publications.
Nickname editing lives in Settings → Profile and changes no publication objects.
`resolvePublicIdentity` is the shared live-name resolver for Feed and future public
Profile/Internet views. An empty nickname uses the persisted random alias;
neither alias nor publicId is derived from internal userId. PublicId groups authors
independently of nickname changes/collisions. DisplayLabel adds ` ›` only when
name disclosure is allowed. Reader payload never includes the internal/full name;
the future disclosure layer must check current consent before exposing it.

Nickname comparison uses trim → NFC → Unicode lowercase → NFC; display spelling
is preserved (apart from edge whitespace). Saving a nickname checks all available
`publicProfile:*` records in the same settings write transaction and rejects a
collision owned by another publicId with `Этот никнейм уже занят.` Empty nicknames
are not reserved; clearing retains publicId and the existing alias.

There is no global identity directory/server in local v1. This check covers only
identities available in this IndexedDB (including multi-user fixtures), not all JW
users, other devices or other origins. A future server identity repository must
atomically reserve the comparison key under a unique constraint, bound to publicId,
and release the old key in the same transaction when changing/clearing it. A client
preflight check cannot establish global availability. The server must use the same
versioned normalization contract; publication snapshots are never renamed.
Public settings persist in the existing settings store and full backup without a
schema or backup-format change. Author-visibility UI remains deferred.

Factories accept a transaction runner, flush, clock and ID generator for
isolated tests. Default exports use the existing storage/maintenance boundary.
No module opens IndexedDB or runs creation on import. Immutability is an API
contract, not protection from direct DevTools writes to IndexedDB.

Tests use only independent fake IndexedDB UUID databases, including fixtures for
three userIds, concurrency conflicts, multi-channel rollback, source preservation,
full reopen and backup v3 restore/reopen/compare of repository-created records,
plus v1/v2 restore followed by a lossless isolated upgrade to v6.

## Live source anchors (v6)

`publication.source.range`, source revision/hashes and snapshot remain immutable
historical provenance. `publicationAnchors`, keyed by publicationId, stores
owner, sourceType/sourceId, coordinateVersion, current sourceRevision, status
(`attached` or `detached`) and range (null when detached). No display name,
title, snapshot content or editor history is duplicated there.

`listArchivePublications(userId, sourceId)` reads publications, text revision and
anchors in one readonly transaction. Its UI projection carries `liveAnchor`;
missing/stale anchors never fall back to historical coordinates. Rail positioning
and picker duplicate state use `attachedLiveRange`. Public reader/owner snapshot
views continue using immutable publication content only.

Exact duplicates are checked atomically against active attached anchors of the
same owner/source/channel. Overlaps and nesting are allowed. A detached record
does not block a new exact-range publication. The historical range index is
non-unique; two ranges can converge during an edit or Undo without blocking the
source save. A revision-inconsistent attached anchor fails closed on creation.

Accepted editor steps travel through the day queue to the repository. Before
mapping, the repository rereads source revision, replays whitelisted steps against
the actual source document and verifies the resulting document equals the saved
snapshot. Source/day updates and anchor updates commit in one transaction.
IME, transfer to another day and retries use the actual accepted steps. Legacy
archive hard-break coordinates convert to editor paragraph coordinates through
original-string offsets only during a real edit, without altering the publication.
Readonly archive formatting/semantic saves preserve coordinates and atomically
advance anchor revision under the existing archive whitelist.

Positional steps are wrapped in reversible `PublicationTextStep` inside the
existing `SemanticStep`. A full deletion/replacement detaches the anchor. Only
after commit does the step's session receipt remember the prior range; the
persisted detached marker identifies that step and direction. The inverse step
restores the receipt's range, rebased through ProseMirror history mapping; redo
detaches again. Publications created after an insertion can similarly recover
on redo. Deleted publications are not resurrected. Receipts are not persisted;
reopen starts a new Undo session and does not guess detached coordinates.

`analyzePublicationRecovery(userId, sourceId?)` reads one consistent snapshot and
reports candidates without writing. Exact original-string matches preserve
whitespace, Unicode and line endings; unique/ambiguous/missing results remain
reports, never automatic repairs. A later approved repair must reread revision
and identity before writing anchors only. Titles and fuzzy prefix/suffix matches
are not authoritative anchors. v5 → v6 leaves all historical anchors missing.

`recoverExactPublicationAnchors(userId, confirmations)` is explicit and resolves
only after one atomic commit. Each approved confirmation contains publicationId,
sourceId, current sourceRevision, canonical range, `sourceFingerprintSha256`
(SHA-256 of the parsed archiveSourceFingerprint(text, day)) and `publicationSha256`
(SHA-256 of the publication record), both via `publicationRecoveryProofHash` and
the existing lossless backup codec, so object key order does not affect proofs.
Original content characters are not normalized. The hashes must come from the inspected
report/backup, not silently from an unapproved fresh source.

Recovery flushes live queues, rereads records, validates owner/day identity,
revision, both hashes and the unique literal snapshot match. Inside the final
transaction it rereads all records and rechecks fingerprints and exact ranges,
then adds only anchors. Any stale proof, existing anchor, active attached exact
duplicate or failure aborts the batch. Nested/overlapping ranges and independent
channels are allowed. Unapproved/missing/ambiguous matches remain untouched;
no detached placeholder is created for an unmatched legacy publication. There
is no automatic startup recovery and no write to historical publication records,
snapshots, texts, userDays or settings.

### Explicit manual reattachment and archive controls

`reattachPublicationAnchor(userId, publicationId, source)` accepts only an explicit
selection from the current archive document. A missing legacy anchor or a
persisted detached anchor may remain that way indefinitely: owner libraries keep
showing its immutable publication, but the archive rail shows no detached marker.
There is no automatic snapshot search or fallback to historical provenance.

The archive selection picker lists only detached publications of that source.
Choosing one shows its saved snapshot; only the separate confirmation attaches
it to the selected current range. Cancel makes no writes. Literal equality to
the old snapshot is not required for this deliberate user-selected association.
The repository flushes live queues, canonicalizes and validates the selected
range, then repeats owner/source/day/revision and source fingerprint checks in
one atomic write transaction. It refuses an already attached publication or a
same-channel active attached exact duplicate. Nested ranges and other channels
remain independent. It writes only `publicationAnchors`, clearing any old
`detachedBy` Undo receipt; snapshots and historical provenance are never updated.

Clicking an attached rail marker toggles a transient ProseMirror decoration over
its current live range, without editing the document or replacing native text
selection. Search decorations remain independent. A stale revision or an unsaved
document suppresses the highlight. The marker's `×` opens a confirmation with
Cancel as the default action; confirming uses the existing owner-safe
`deletePublication(userId, publicationId)` contract. Only that publication and
anchor are removed (and an existing profile pin is cleared by that contract).
Other channels, source content, formatting and semantic markup are untouched.

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


## Reader Feed (stage E2)

Reader Feed opens through the existing global `Общая страница`, independently
of Archive → Publications → Feed. There is no additional global `Лента` item. It consumes
`listFeedPublications()` through `listReaderFeedPublications(userId)`, which adds
only the local `isOwn` presentation flag from the owner repository. Even anonymous
own publications are recognized; foreign publications have no remove action.
Deletion always passes through `deletePublication` and its owner validation.
Returning to owner libraries re-reads the store and naturally updates counts.

The public projection allowlists `writtenOn` from the saved archive provenance,
not from the current source. It carries no source IDs, ranges, revisions or private
semantic metadata. Shared `PublicationView`, `PublicationPreview` and
`ReadonlyDocument` render both owner libraries and Reader Feed; all cards start
collapsed. Reader Feed uses the accepted frame, scroll and right metadata rail. Author
identity, the `●` marker, disclosure and owner actions all live in that rail.
`●` marks a publication owned by the current user in Reader Feed.
The reading font matches JW/owner publications; content uses a moderately wider
side inset (44px versus the archive’s 28px, returning to 28px on narrow screens).

Author filters use publicId, never nickname. Returning browser focus refreshes
live identities while retaining this filter. Hidden authors remain `Автор`, with
no public key, name-disclosure action or author filter. Name disclosure permission
and Feed authorVisibility are independent policies.

`loadDisclosedAuthorName(publicId)` is readonly and checks current consent both
before and after lookup. Current-user names come from localProfile; other local
fixture names come from an injected author-profile provider. No historical name
from publication.author is used. Unavailable names have no disclosure action.
The UI reveals a name only after clicking `›`, and can hide it again. A future
server author-profile source can serve the same contract without Public Profile UI.

`src/testFixtures/readerFeed.js` requires an explicit isolated transaction runner;
it never seeds or opens a database on import. Fixtures cover three authors,
visible/hidden authorship, nickname/alias, disclosure, multiple snapshots and
same-time ordering. Production navigation never imports or installs fixtures.

## Public Profile (stage F)

Public Profile is read-only and keyed by stable publicId. Its entry in Reader Feed
requires a non-anonymous author and independent `profileVisible === true`, for
both own and foreign publications. A missing permission reads as false without
writing a default. Name disclosure never grants profile access. Own Feed records
show `● nickname/alias` without a reveal control; foreign reveal state is local to
each publication and displays the permitted name inline.

Existing `settings.publicProfile:${userId}` stores `profileVisible`, plain `about`
(up to 300 Unicode characters), and `links: [{ label, url }]`. Links accept HTTPS
without credentials. Settings replace the former unsaved social/resource mocks
with this persisted public-profile editor. Public settings themselves need no
additional schema changes; full settings records participate in restore/reopen/compare.

Author information renders in the left sidebar, outside the unchanged central
reading frame. Owner Publications → Profile provides `Закрепить в профиле` /
`Открепить`, selecting one `pinnedPublicationId` or null. The settings
repository validates that the selected object still belongs to the current owner
and the Profile channel in the same transaction as saving the pointer. No snapshot
is changed. Public Profile displays that object first with a quiet pinned label,
then the remaining snapshots in the existing chronological order. If the object
is removed, the owner-safe delete transaction clears its matching pointer atomically.
Readers also ignore stale pointers from older/imported records without writing settings.
Owner libraries and Reader Feed ordering and 3+3 previews remain unchanged.
Public Profile uses a compact first-two-visual-lines preview preserving B/I/U;
expansion still renders the full immutable snapshot. The pinned card is first and
uses native sticky positioning at the top of the bounded Public Profile scroller;
its marginal date follows the card, while other dates stay below its visible area.
Unpinning/removing the object removes sticky presentation as well as the pin.
Its footer derives the count
of this author's active Profile publications, with Russian text noun inflection.

`loadPublicAuthorStats(publicId)` returns `{ joinedAt, writingDays, totalWords }`
or null. Current-user aggregates are computed inside a readonly repository adapter
using the same writing-entry helper as Research. Other authors use an injected
readonly stats provider; the default has no foreign stats source and returns null.
No private texts are delivered to Reader UI. `joinedAt` uses trustworthy localProfile
createdAt only; missing/invalid dates remain null. No oldest-text/date-now fallback,
import reconstruction or new saved counter exists. Publications never enter totals.

`loadPublicProfile(publicId)` checks permission before reads and again after async
providers, returning a safe live profile plus immutable Profile-channel cards.
It uses `loadDisclosedAuthorName`, current profile settings and a reader projection
of stored snapshots: no source re-render, owner controls, private markup or provenance.
Stats/name unavailability does not hide other available profile data. The shared
PublicProfileView is identical for owners-as-guests and foreign readers.

Reader Feed profile links return directly to the mounted Reader Feed, preserving
publicId author filter, card expansion and scroll. My Texts also offers a direct
`Профиль` entry only when the existing identity has `profileVisible === true`.
It opens the same publicId-based projection and renderer, with no owner controls;
back returns to the mounted archive with its calendar period, expansion and scroll.
Navigation reads existing identity without initializing settings.
Fixtures explicitly provide multiple authors and stats, and run on isolated IDB only.
