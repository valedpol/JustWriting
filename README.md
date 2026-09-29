# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Just Writing: local storage, step 1

The editor now uses IndexedDB database `just-writing` (schema version 1).
`settings` holds a persistent local profile; `texts` holds committed daily texts.
Opening the app does not create a text. A first non-whitespace edit creates one;
clearing an existing text preserves its ID and stores an empty content string.
The existing localStorage experiment is neither read nor migrated nor deleted.

Every edit is queued for an IndexedDB transaction immediately. The UI reports
«Сохранено» only after the latest write commits. Errors retain the editor buffer
and offer retry. A stale revision is rejected instead of overwriting a newer
record; full multi-tab coordination is not part of this step.

«Мои тексты» reads `texts` after pending saves complete and displays read-only
snapshots. Return to «Текст сегодня» to edit the current draft. The archive does
not create records or edit their contents.

Run `npm test`, `npm run build`, and `npm run lint` for automated checks. Tests
use fake-indexeddb; real browser persistence still needs manual acceptance.

Manual acceptance (use the same URL/browser profile throughout):
1. Open an unused browser profile. Open «Мои тексты»: the list is empty.
2. Open «Текст сегодня», type a few lines, wait for «Сохранено», reload.
3. Check that all text is restored. Open «Мои тексты», select the saved date,
   verify full text, word count, and that typing cannot edit the saved snapshot.
4. Return to today's editor, edit, save, reload: one record, same textId,
   larger revision. Clear the text and reload: record remains, content is empty.
5. In DevTools > Application > IndexedDB > just-writing > texts, refresh and
   inspect textId, dayKey, content, revision, createdAt and updatedAt.
   Opening and browsing alone must not increase revision or add texts.

This step has no server, sync outbox, word-count samples, service worker, or
live midnight rollover. Local calendar day is chosen on load; timezone/day-policy
handling and switching an already-open editor at midnight are step 2. Reopening
without a network connection is a later step. Browser data clearing removes
local records. Do not use this test build as the only copy of important writing.

## User-day model: schema version 2 (lifecycle not connected yet)

The upgrade creates `userDays` with a unique `[userId, dayKey]` index and links
existing texts through `userDayId`. Text identity, contents, revisions and all
original timestamps remain unchanged. Recorded boundaries are copied, not
recalculated. Periods whose end has passed at upgrade are marked `closed`;
`closedAt` is that recorded end, not the time the upgrade ran. Grace fields are
null. Invalid/missing boundaries abort the whole upgrade; version 1 data remain
intact. Opening a new/empty database creates no text or period.

New text creation atomically creates its period; later saves retain the link.
This is structural groundwork only: the editor does not yet enforce closed-day
states, roll over at midnight or apply profile day settings. Existing `open`
periods are not automatically closed on subsequent database opens at this step.

Manual acceptance:
1. Finish saving and close other JW tabs. Open/reload the app at the same origin.
2. In DevTools > Application > IndexedDB, refresh `just-writing`: version 2,
   stores `settings`, `texts`, `userDays`.
3. Compare existing texts: same textId, dayKey, content, revision and timestamps;
   only userDayId is added. Match it to userDays.userDayId.
4. Past periods: state closed, closedAt equals endsAt. The current unexpired
   period: open, closedAt null. Grace fields remain null.
5. Reload again: no duplicate periods and unchanged IDs. Check archive and
   today's editor still show the same text.
6. In a separate clean profile, merely open JW: texts/userDays are empty. Type,
   wait for Saved: one text and one linked period. Edit/clear: same linked IDs.

Do not delete/reset a database to address a migration error. Preserve the data
and report the problem for investigation. Automated rollback tests use isolated
fake-indexeddb databases, not the user's browser records.
