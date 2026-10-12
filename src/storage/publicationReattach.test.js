import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { connectDatabase } from './database.js'
import { createManualPublicationAnchorRepository } from './publicationAnchorRepository.js'
import { createPublicationRepository } from './publicationRepository.js'
import { initialPublicationAnchor } from '../publications/liveAnchors.js'
import { archiveDocument } from '../editor/archiveDocument.js'
import { parseDocument } from '../editor/document.js'

const connections = []
globalThis.IDBKeyRange = IDBKeyRange
test.after(() => connections.forEach(db => db.close()))
async function fixture(content = 'alpha beta gamma') {
  const factory = new IDBFactory(), name = `reattach-${crypto.randomUUID()}`
  let db = await connectDatabase({ factory, name }); connections.push(db)
  const transact = (stores, mode, run) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode); let value, failure
    tx.oncomplete = () => resolve(value); tx.onabort = () => reject(failure || tx.error); tx.onerror = () => {}
    try { run(tx, result => { value = result }, error => { failure = error; tx.abort() }) }
    catch (error) { failure = error; tx.abort() }
  })
  const text = { userId: 'u', textId: 't', userDayId: 'd', dayKey: '2026-10-07', revision: 7, content,
    semanticMarkup: [], private: { nil: null, missing: undefined, bytes: new Uint8Array([1, 2]) } }
  const day = { userId: 'u', userDayId: 'd', dayKey: text.dayKey, revision: 2 }
  const publication = { publicationId: 'p', userId: 'u', channel: 'feed', publishedAt: 1,
    source: { sourceType: 'archive', sourceId: 't', sourceRevision: 1, coordinateVersion: 1, range: { from: 1, to: 5 },
      archive: { userDayId: 'd', dayKey: text.dayKey } }, snapshot: { content: 'historical missing fragment', title: 'Historical title' } }
  await transact(['texts', 'userDays', 'publications', 'settings'], 'readwrite', tx => {
    tx.objectStore('texts').add(text); tx.objectStore('userDays').add(day); tx.objectStore('publications').add(publication)
    tx.objectStore('settings').add({ key: 'private', value: text.private })
  })
  let beforeWrite, flush = async () => {}, flushed = 0
  const runTransaction = async (stores, mode, run) => {
    if (mode === 'readwrite' && beforeWrite) { const action = beforeWrite; beforeWrite = null; await action() }
    return transact(stores, mode, run)
  }
  const repo = createManualPublicationAnchorRepository({ runTransaction, flush: async () => { flushed++; await flush() } })
  const source = { sourceType: 'archive', sourceId: 't', sourceRevision: 7, coordinateVersion: 1,
    range: { from: 7, to: 11 }, archive: { userDayId: 'd', dayKey: text.dayKey } }
  const read = () => transact([...db.objectStoreNames], 'readonly', (tx, done) => {
    const data = {}; done(data)
    for (const name of tx.objectStoreNames) { const r = tx.objectStore(name).getAll(); r.onsuccess = () => { data[name] = r.result } }
  })
  return { repo, source, publication, text, day, transact, read, runTransaction,
    flushed: () => flushed, setFlush: action => { flush = action }, setBeforeWrite: action => { beforeWrite = action },
    reopen: async () => { db.close(); db = await connectDatabase({ factory, name }); connections.push(db) } }
}
function onlyAnchorChanged(before, after) {
  for (const name of Object.keys(before).filter(name => name !== 'publicationAnchors')) assert.deepEqual(after[name], before[name])
}

test('manual reattach requires a selected range, writes only anchor, accepts a changed fragment and persists after full reopen', async () => {
  const f = await fixture(), before = await f.read()
  await assert.rejects(f.repo.reattach('u', 'p'), /source/)
  assert.deepEqual(await f.read(), before)
  const anchor = await f.repo.reattach('u', 'p', f.source)
  assert.equal(f.flushed(), 1)
  assert.deepEqual(anchor, { publicationId: 'p', userId: 'u', sourceType: 'archive', sourceId: 't', sourceRevision: 7,
    coordinateVersion: 1, status: 'attached', range: { from: 7, to: 11 } })
  await f.reopen()
  const after = await f.read(); assert.deepEqual(after.publicationAnchors, [anchor]); onlyAnchorChanged(before, after)
  assert.equal(after.publications[0].snapshot.content, 'historical missing fragment')
  await assert.rejects(f.repo.reattach('u', 'p', f.source), /not detached/)
})

test('detached publication remains in owner library indefinitely; explicit reattach clears the old Undo receipt only', async () => {
  const f = await fixture()
  await f.transact(['publicationAnchors'], 'readwrite', tx => tx.objectStore('publicationAnchors').add({
    ...initialPublicationAnchor(f.publication), status: 'detached', range: null, sourceRevision: 7, detachedBy: { id: 'old', side: 'after' },
  }))
  const owner = createPublicationRepository({ runTransaction: f.runTransaction })
  await f.reopen()
  assert.deepEqual(await owner.listOwnPublications('u', 'feed'), [f.publication])
  const before = await f.read(); assert.equal(before.publicationAnchors[0].status, 'detached')
  const anchor = await f.repo.reattach('u', 'p', f.source)
  assert.equal(anchor.detachedBy, undefined); assert.equal(anchor.status, 'attached')
  onlyAnchorChanged(before, await f.read())
})

test('owner, source/day identity, revision, coordinates, invalid/empty ranges and unavailable publications fail closed', async () => {
  const f = await fixture(), before = await f.read()
  await assert.rejects(f.repo.reattach('foreign', 'p', f.source), /owner/)
  await assert.rejects(f.repo.reattach('u', 'missing', f.source), /unavailable/)
  for (const change of [{ sourceType: 'project' }, { sourceId: 'missing' }, { sourceRevision: 6 }, { coordinateVersion: 2 },
    { archive: { userDayId: 'other', dayKey: f.text.dayKey } }, { archive: { userDayId: 'd', dayKey: '2026-10-08' } },
    { range: null }, { range: { from: 7, to: 7 } }, { range: { from: -1, to: 4 } }, { range: { from: 1, to: 99 } },
    { range: { from: 1.5, to: 4 } }]) {
    await assert.rejects(f.repo.reattach('u', 'p', { ...f.source, ...change }))
    assert.deepEqual(await f.read(), before)
  }
  for (const change of [{ userId: 'foreign' }, { source: { ...f.publication.source, sourceId: 'other' } }]) {
    await f.transact(['publications'], 'readwrite', tx => tx.objectStore('publications').put({ ...f.publication, ...change }))
    const changed = await f.read(); await assert.rejects(f.repo.reattach('u', 'p', f.source), /unavailable/)
    assert.deepEqual(await f.read(), changed)
  }
})

test('flush failure makes no writes and caller input cannot change while flush is pending', async () => {
  const f = await fixture(), before = await f.read()
  f.setFlush(async () => { throw new Error('unsaved') })
  await assert.rejects(f.repo.reattach('u', 'p', f.source), /unsaved/); assert.deepEqual(await f.read(), before)
  let release
  f.setFlush(() => new Promise(resolve => { release = resolve }))
  const input = structuredClone(f.source), pending = f.repo.reattach('u', 'p', input)
  input.range = { from: 1, to: 3 }; release()
  assert.deepEqual((await pending).range, { from: 7, to: 11 })
})

test('transaction boundary rechecks revision, content, day, attachment races and publication deletion/owner', async () => {
  for (const change of ['revision', 'content', 'day', 'attached', 'deleted', 'owner']) {
    const f = await fixture()
    f.setBeforeWrite(() => f.transact(['texts', 'userDays', 'publicationAnchors', 'publications'], 'readwrite', tx => {
      if (change === 'revision') tx.objectStore('texts').put({ ...f.text, revision: 8 })
      if (change === 'content') tx.objectStore('texts').put({ ...f.text, content: 'alpha BETA gamma' })
      if (change === 'day') tx.objectStore('userDays').put({ ...f.day, revision: 3 })
      if (change === 'attached') tx.objectStore('publicationAnchors').add({ ...initialPublicationAnchor(f.publication), sourceRevision: 7 })
      if (change === 'deleted') tx.objectStore('publications').delete('p')
      if (change === 'owner') tx.objectStore('publications').put({ ...f.publication, userId: 'foreign' })
    }))
    await assert.rejects(f.repo.reattach('u', 'p', f.source), /conflict|changed|not detached|unavailable/)
    assert.equal((await f.read()).publicationAnchors.length, change === 'attached' ? 1 : 0)
  }
})

test('same-channel attached exact duplicate blocks reattach; detached, nested and independent channel publications do not', async () => {
  for (const [channel, status, range, blocked] of [['feed', 'attached', { from: 7, to: 11 }, true],
    ['profile', 'attached', { from: 7, to: 11 }, false], ['feed', 'detached', null, false],
    ['feed', 'attached', { from: 1, to: 17 }, false]]) {
    const f = await fixture(), other = { ...f.publication, publicationId: 'other', channel }
    await f.transact(['publications', 'publicationAnchors'], 'readwrite', tx => {
      tx.objectStore('publications').add(other)
      tx.objectStore('publicationAnchors').add({ ...initialPublicationAnchor(other), status, range, sourceRevision: 7 })
    })
    const before = await f.read()
    if (blocked) { await assert.rejects(f.repo.reattach('u', 'p', f.source), { name: 'ConstraintError' }); assert.deepEqual(await f.read(), before) }
    else { await f.repo.reattach('u', 'p', f.source); onlyAnchorChanged(before, await f.read()) }
  }
})

test('invalid detached anchor identities and stale revisions cannot be overwritten', async () => {
  for (const change of [{ userId: 'foreign' }, { sourceId: 'other' }, { sourceType: 'project' }, { coordinateVersion: 2 },
    { sourceRevision: 6 }, { status: 'unknown' }]) {
    const f = await fixture()
    await f.transact(['publicationAnchors'], 'readwrite', tx => tx.objectStore('publicationAnchors').add({
      ...initialPublicationAnchor(f.publication), status: 'detached', range: null, sourceRevision: 7, ...change,
    }))
    const before = await f.read(); await assert.rejects(f.repo.reattach('u', 'p', f.source), /conflict/)
    assert.deepEqual(await f.read(), before)
  }
})

test('manual reattach preserves legacy CRLF, whitespace and Unicode and canonicalizes whole-day selection', async () => {
  const f = await fixture(' 😀\r\n beta \r'), before = await f.read()
  const size = parseDocument(archiveDocument(f.text)).content.size
  const anchor = await f.repo.reattach('u', 'p', { ...f.source, range: { from: 0, to: size } })
  assert.deepEqual(anchor.range, { from: 1, to: size - 1 })
  onlyAnchorChanged(before, await f.read())
})

test('aborted transaction commits neither anchor nor changes to any protected store', async () => {
  const f = await fixture(), before = await f.read()
  const repo = createManualPublicationAnchorRepository({ flush: async () => {}, runTransaction: (stores, mode, run) =>
    f.transact(stores, mode, (tx, done, fail) => run(tx, result => { done(result); if (mode === 'readwrite') tx.abort() }, fail)) })
  await assert.rejects(repo.reattach('u', 'p', f.source)); assert.deepEqual(await f.read(), before)
})
