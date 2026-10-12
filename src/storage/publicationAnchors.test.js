import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeHistory, undo, redo, undoDepth } from '@tiptap/pm/history'
import { ReplaceStep, Step, StepResult } from '@tiptap/pm/transform'
import { openDaySession } from '../editor/daySession.js'
import { editorSnapshot } from '../editor/dayOperations.js'
import { legacyToDocument, parseDocument } from '../editor/document.js'
import { archiveDocument } from '../editor/archiveDocument.js'
import { SemanticStep } from '../editor/semanticHistory.js'
import { PublicationTextStep } from '../editor/publicationHistory.js'
import { resolveToday } from './dayRepository.js'
import { transaction, openDatabase } from './database.js'
import { saveRichText, saveText, loadText } from './textRepository.js'
import { createPublicationRepository } from './publicationRepository.js'
import { listSourcePublicationAnchors, analyzePublicationRecovery, createManualPublicationAnchorRepository } from './publicationAnchorRepository.js'
import { saveSemanticMarkup } from './semanticRepository.js'
import { saveArchivePresentation } from './archivePresentationRepository.js'
import { attachedLiveRange } from '../publications/liveAnchors.js'

const now = Date.parse('2026-10-11T10:00:00Z')
test.after(async () => (await openDatabase()).close())
async function fixture(text = 'alpha beta gamma', legacy = false) {
  const profile = { key: 'localProfile', userId: crypto.randomUUID(), displayName: 'Author', createdAt: now,
    timeZone: 'UTC', dayStartMinutes: 0, dayPolicyVersion: 1 }
  await transaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put(profile))
  const day = await resolveToday(profile, now)
  if (legacy) await saveText(day.context, null, text, now)
  else await saveRichText(day.context, null, { contentFormat: 'tiptap-json', contentVersion: 1,
    document: legacyToDocument(text), semanticMarkup: [] }, now)
  const session = await openDaySession({ profile, now })
  const repo = createPublicationRepository({ flush: () => session.flush(), now: () => now })
  const publish = (range, channels = ['feed']) => {
    const record = session.current.record
    return repo.createPublications(profile.userId, { channels, source: { sourceType: 'archive', sourceId: record.textId,
      sourceRevision: record.revision, coordinateVersion: 1, range,
      archive: { userDayId: record.userDayId, dayKey: record.dayKey } } })
  }
  const anchors = () => listSourcePublicationAnchors(profile.userId, session.current.record.textId)
  const publications = () => repo.listOwnPublications(profile.userId, 'feed')
  const edit = (tr, kind = 'input') => session.dispatch(tr, { kind, acceptedAt: now + 1 })
  const command = async action => {
    let tr
    assert.ok(action(session.current.state, value => { tr = value }))
    return edit(tr, action === undo ? 'undo' : 'redo')
  }
  return { profile, session, repo, publish, anchors, publications, edit, command }
}

test('create + anchor are atomic; insertion before/inside maps live range while historical source and snapshot stay immutable', async () => {
  const f = await fixture(), [publication] = await f.publish({ from: 7, to: 11 }, ['feed', 'profile'])
  await f.edit(f.session.current.state.tr.insertText('XX', 1))
  assert.deepEqual((await f.anchors()).map(a => a.range), [{ from: 9, to: 13 }, { from: 9, to: 13 }])
  await f.edit(f.session.current.state.tr.insertText('Y', 10))
  assert.ok((await f.anchors()).every(a => a.range.from === 9 && a.range.to === 14 && a.sourceRevision === f.session.current.record.revision))
  assert.deepEqual(await f.publications(), [publication])
  const live = await f.repo.listArchivePublications(f.profile.userId, publication.source.sourceId)
  assert.deepEqual(attachedLiveRange(live.find(p => p.publicationId === publication.publicationId)), { from: 9, to: 14 })
  await assert.rejects(f.publish({ from: 9, to: 14 }), { name: 'ConstraintError' })
  const [other] = await f.publish({ from: 7, to: 11 })
  assert.notEqual(other.publicationId, publication.publicationId, 'old historical coordinates no longer block a different live fragment')
})

test('complete deletion detaches; Undo restores exact range, redo detaches; detached allows republishing; Undo never deletes the new object', async () => {
  const f = await fixture(), [old] = await f.publish({ from: 7, to: 11 })
  await f.edit(closeHistory(f.session.current.state.tr).delete(7, 11), 'delete')
  let anchor = (await f.anchors())[0]
  assert.equal(anchor.status, 'detached'); assert.equal(anchor.range, null)
  assert.equal((await f.publications())[0].snapshot.content, 'beta')
  await f.command(undo)
  assert.deepEqual((await f.anchors())[0].range, { from: 7, to: 11 })
  await f.command(redo)
  assert.equal((await f.anchors())[0].status, 'detached')
  const [newPublication] = await f.publish({ from: 7, to: 11 })
  await f.command(undo)
  assert.equal((await f.anchors()).find(a => a.publicationId === old.publicationId).status, 'attached')
  assert.equal((await f.publications()).length, 2)
  await f.repo.deletePublication(f.profile.userId, old.publicationId)
  await f.command(redo)
  assert.deepEqual((await f.publications()).map(p => p.publicationId), [newPublication.publicationId])
  assert.equal((await f.anchors()).length, 1)
})

test('replacement detaches without losing snapshot; Undo/redo grouped multi-step deletion and insertion recover the anchor', async () => {
  const f = await fixture(), [p] = await f.publish({ from: 7, to: 11 })
  await f.edit(closeHistory(f.session.current.state.tr).insertText('changed', 7, 11))
  assert.equal((await f.anchors())[0].status, 'detached')
  await f.command(undo)
  assert.deepEqual((await f.anchors())[0].range, { from: 7, to: 11 })
  await f.command(redo)
  assert.equal((await f.anchors())[0].status, 'detached')
  assert.deepEqual(await f.publications(), [p])
})

test('publication created after insertion can detach on Undo and recover on redo without recreating the publication', async () => {
  const f = await fixture()
  await f.edit(closeHistory(f.session.current.state.tr).insertText('NEW', 7))
  const [p] = await f.publish({ from: 7, to: 10 })
  await f.command(undo)
  assert.equal((await f.anchors())[0].status, 'detached')
  await f.command(redo)
  assert.deepEqual((await f.anchors())[0].range, { from: 7, to: 10 })
  assert.deepEqual(await f.publications(), [p])
})

test('split/join, IME and reopened editor map anchors; reopened history does not reconstruct deleted ranges', async () => {
  const f = await fixture(), [p] = await f.publish({ from: 7, to: 11 })
  await f.edit(f.session.current.state.tr.split(3))
  assert.deepEqual((await f.anchors())[0].range, { from: 9, to: 13 })
  await f.command(undo)
  const composition = f.session.beginComposition()
  f.session.updateComposition(composition, f.session.current.state.tr.insertText('IME', 1))
  await f.session.finishComposition(composition, { acceptedAt: now + 2 })
  assert.deepEqual((await f.anchors())[0].range, { from: 10, to: 14 })
  const reopened = await openDaySession({ profile: f.profile, now: now + 3 })
  assert.equal(undoDepth(reopened.current.state), 0)
  await reopened.dispatch(reopened.current.state.tr.delete(10, 14), { acceptedAt: now + 4, kind: 'delete' })
  const again = await openDaySession({ profile: f.profile, now: now + 5 })
  assert.equal(undoDepth(again.current.state), 0)
  assert.equal((await f.anchors())[0].status, 'detached')
  assert.deepEqual(await f.publications(), [p])
})

test('revision conflict, missing/forged mapping and unknown nested steps abort both source and anchor writes', async () => {
  const f = await fixture(); await f.publish({ from: 7, to: 11 })
  const old = f.session.current.record, state = f.session.current.state
  const before = await f.anchors()
  const changed = { ...editorSnapshot(state), document: state.tr.insertText('X', 1).doc.toJSON() }
  await assert.rejects(saveRichText(f.session.current.context, old, changed, now), /accepted transaction/)
  await assert.rejects(saveRichText(f.session.current.context, old, changed, now, null,
    { beforeDocument: state.doc.toJSON(), steps: [] }), /target document/)
  class UnknownStep extends Step { apply(doc) { return StepResult.ok(doc) } }
  for (const step of [new UnknownStep(), new SemanticStep([], [], new PublicationTextStep(new UnknownStep())),
    new PublicationTextStep(new PublicationTextStep(new ReplaceStep(1, 1, state.doc.slice(1, 2))))]) {
    await assert.rejects(saveRichText(f.session.current.context, old, editorSnapshot(state), now, null,
      { beforeDocument: state.doc.toJSON(), steps: [step] }), /Unsupported/)
  }
  assert.deepEqual(await f.anchors(), before)
  assert.deepEqual(await loadText(f.profile.userId, old.dayKey), old)
  const other = await openDaySession({ profile: f.profile, now })
  await other.dispatch(other.current.state.tr.insertText('A', 1), { acceptedAt: now + 1 })
  const actual = await f.anchors()
  await assert.rejects(f.edit(state.tr.insertText('B', 1)), /другой вкладке/)
  assert.deepEqual(await f.anchors(), actual)
})

test('archive formatting/semantic changes preserve positions and advance anchor revision atomically', async () => {
  const f = await fixture(); await f.publish({ from: 7, to: 11 })
  let record = f.session.current.record
  const doc = parseDocument(record.document)
  const state = f.session.current.state
  record = await saveArchivePresentation(f.profile.userId, record, state.tr.addMark(7, 11, doc.type.schema.marks.bold.create()))
  record = await saveSemanticMarkup(f.profile.userId, record, [{ id: 'tag', valueId: 'tag', kind: 'tag', value: 'private',
    source: 'selection', direction: 'backward', anchor: 11, range: { from: 7, to: 11 } }])
  assert.deepEqual((await f.anchors())[0].range, { from: 7, to: 11 })
  assert.equal((await f.anchors())[0].sourceRevision, record.revision)
})

test('legacy CRLF coordinates rebase to editor paragraphs only during a genuine edit, historical snapshot keeps exact line endings', async () => {
  const f = await fixture('alpha\r\nbeta', true)
  const original = f.session.current.record, doc = parseDocument(archiveDocument(original))
  const [p] = await f.publish({ from: 1, to: doc.content.size - 1 })
  assert.equal(p.snapshot.content, 'alpha\r\nbeta')
  assert.deepEqual(await loadText(f.profile.userId, original.dayKey), original, 'publication creation does not normalize legacy source')
  await f.edit(f.session.current.state.tr.insertText('X', 1))
  assert.deepEqual((await f.anchors())[0].range, { from: 2, to: f.session.current.state.doc.content.size - 1 })
  assert.equal((await f.publications())[0].snapshot.content, 'alpha\r\nbeta')
})

test('recovery is readonly and missing historical anchors never become fallback UI ranges', async () => {
  const f = await fixture(), [p] = await f.publish({ from: 7, to: 11 })
  await transaction(['publicationAnchors'], 'readwrite', tx => tx.objectStore('publicationAnchors').delete(p.publicationId))
  const result = await analyzePublicationRecovery(f.profile.userId, p.source.sourceId)
  assert.equal(result[0].status, 'unique-exact-candidate')
  assert.deepEqual(result[0].candidates, [{ from: 7, to: 11 }])
  assert.deepEqual(await f.anchors(), [])
  const [ui] = await f.repo.listArchivePublications(f.profile.userId, p.source.sourceId)
  assert.equal(attachedLiveRange(ui), null)
  assert.deepEqual(await f.publications(), [p])
})

test('anchor add failure rolls back publication creation; an orphan anchor does not count as an active duplicate', async () => {
  const f = await fixture(), id = crypto.randomUUID()
  await transaction(['publicationAnchors'], 'readwrite', tx => tx.objectStore('publicationAnchors').add({
    publicationId: id, userId: f.profile.userId, sourceType: 'archive', sourceId: f.session.current.record.textId,
    sourceRevision: f.session.current.record.revision, coordinateVersion: 1, status: 'attached', range: { from: 7, to: 11 },
  }))
  const failing = createPublicationRepository({ flush: () => f.session.flush(), id: () => id })
  const record = f.session.current.record
  const source = { sourceType: 'archive', sourceId: record.textId, sourceRevision: record.revision, coordinateVersion: 1,
    range: { from: 7, to: 11 }, archive: { userDayId: record.userDayId, dayKey: record.dayKey } }
  await assert.rejects(failing.createPublications(f.profile.userId, { source, channels: ['feed'] }), { name: 'ConstraintError' })
  assert.deepEqual(await f.publications(), [])
  await f.publish({ from: 7, to: 11 })
  assert.equal((await f.publications()).length, 1)
})

test('day transfer uses the receiving document mapping and never moves the old day anchors', async () => {
  const f = await fixture(); await f.publish({ from: 7, to: 11 })
  const before = await f.anchors(), record = f.session.current.record
  await f.session.dispatch(f.session.current.state.tr.insertText('NEXT', 1), {
    acceptedAt: f.session.current.context.dayEndsAt + 120000, kind: 'input',
  })
  assert.notEqual(f.session.current.record.textId, record.textId)
  assert.deepEqual(await listSourcePublicationAnchors(f.profile.userId, record.textId), before)
})

test('failed anchor mapping write leaves source unchanged and retry commits the receipt exactly once', async () => {
  const f = await fixture(), [p] = await f.publish({ from: 7, to: 11 })
  const original = f.session.current.record, anchor = (await f.anchors())[0]
  await transaction(['publicationAnchors'], 'readwrite', tx => tx.objectStore('publicationAnchors').put({ ...anchor, sourceRevision: -1 }))
  const operation = f.session.capture(closeHistory(f.session.current.state.tr).delete(7, 11), { kind: 'delete', acceptedAt: now + 1 })
  await assert.rejects(f.session.submit(operation), /anchor revision/)
  assert.deepEqual(await loadText(f.profile.userId, original.dayKey), original)
  await transaction(['publicationAnchors'], 'readwrite', tx => tx.objectStore('publicationAnchors').put(anchor))
  await f.session.retry(operation.id)
  await f.command(undo)
  assert.deepEqual((await f.anchors())[0].range, { from: 7, to: 11 })
  assert.deepEqual(await f.publications(), [p])
})

test('Undo recovery rebases receipts through an intervening non-history edit', async () => {
  const f = await fixture(); await f.publish({ from: 7, to: 11 })
  await f.edit(closeHistory(f.session.current.state.tr).delete(7, 11), 'delete')
  await f.edit(f.session.current.state.tr.insertText('X', 1).setMeta('addToHistory', false))
  await f.command(undo)
  assert.deepEqual((await f.anchors())[0].range, { from: 8, to: 12 })
  await f.command(redo)
  assert.equal((await f.anchors())[0].status, 'detached')
})

test('manual reattach supersedes an old detach receipt and follows subsequent editor mapping, Undo/redo and reopen without changing the snapshot', async () => {
  const f = await fixture(), [p] = await f.publish({ from: 7, to: 11 })
  await f.edit(closeHistory(f.session.current.state.tr).delete(7, 11), 'delete')
  assert.ok((await f.anchors())[0].detachedBy)
  const record = f.session.current.record
  const manual = createManualPublicationAnchorRepository({ flush: () => f.session.flush() })
  await manual.reattach(f.profile.userId, p.publicationId, { sourceType: 'archive', sourceId: record.textId,
    sourceRevision: record.revision, coordinateVersion: 1, range: { from: 1, to: 6 },
    archive: { userDayId: record.userDayId, dayKey: record.dayKey } })
  await f.command(undo)
  assert.deepEqual((await f.anchors())[0].range, { from: 1, to: 6 }, 'old deletion Undo does not reclaim the historical range')
  await f.command(redo)
  assert.equal((await f.anchors())[0].status, 'attached')
  assert.deepEqual((await f.anchors())[0].range, { from: 1, to: 6 })
  await f.edit(closeHistory(f.session.current.state.tr).insertText('X', 1))
  assert.deepEqual((await f.anchors())[0].range, { from: 2, to: 7 })
  const reopened = await openDaySession({ profile: f.profile, now: now + 10 })
  await reopened.dispatch(reopened.current.state.tr.insertText('Y', 1), { acceptedAt: now + 11, kind: 'input' })
  assert.deepEqual((await f.anchors())[0].range, { from: 3, to: 8 })
  assert.deepEqual(await f.publications(), [p])
})
