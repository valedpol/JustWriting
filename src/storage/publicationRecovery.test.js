import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { connectDatabase } from './database.js'
import { createPublicationAnchorRecoveryRepository, publicationRecoveryProofHash } from './publicationAnchorRepository.js'
import { archiveSourceFingerprint } from '../publications/archiveSource.js'
import { exactSnapshotRanges } from '../publications/anchorRecovery.js'
const hash = text => publicationRecoveryProofHash(JSON.parse(text))
const connections = []
test.after(() => connections.forEach(db => db.close()))
async function fixture(content = 'prefix beta suffix', snapshot = 'beta') {
  const factory = new IDBFactory(), name = `recovery-${crypto.randomUUID()}`
  let db = await connectDatabase({ factory, name }); connections.push(db)
  const transact = (stores, mode, run) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode); let result, failure
    tx.oncomplete = () => resolve(result)
    tx.onabort = () => reject(failure || tx.error)
    tx.onerror = () => {}
    try { run(tx, value => { result = value }, error => { failure = error; tx.abort() }) }
    catch (error) { failure = error; tx.abort() }
  })
  const text = { textId: 't', userId: 'u', userDayId: 'd', dayKey: '2026-10-07', revision: 3,
    content, semanticMarkup: [], unknown: { nil: null, bytes: new Uint8Array([1, 2]) } }
  const day = { userDayId: 'd', userId: 'u', dayKey: text.dayKey, revision: 4 }
  const publications = ['feed', 'profile'].map((channel, i) => ({ publicationId: `p${i}`, userId: 'u', channel, publishedAt: 1,
    source: { sourceType: 'archive', sourceId: 't', sourceRevision: 1, coordinateVersion: 1, range: { from: 1, to: 5 },
      archive: { userDayId: 'd', dayKey: text.dayKey } }, snapshot: { content: snapshot, title: 'Historical title' } }))
  publications.push({ ...publications[0], publicationId: 'unmatched', snapshot: { content: 'missing original' } })
  await transact(['texts', 'userDays', 'publications', 'settings'], 'readwrite', tx => {
    tx.objectStore('texts').add(text); tx.objectStore('userDays').add(day)
    publications.forEach(p => tx.objectStore('publications').add(p))
    tx.objectStore('settings').add({ key: 'unchanged', value: 'private' })
  })
  const proofs = await Promise.all(publications.slice(0, 2).map(async p => ({ publicationId: p.publicationId, sourceId: text.textId,
    sourceRevision: text.revision, range: exactSnapshotRanges(text, snapshot)[0],
    sourceFingerprintSha256: await hash(archiveSourceFingerprint(text, day)), publicationSha256: await hash(JSON.stringify(p)) })))
  let beforeWrite, flushed = 0
  const repo = createPublicationAnchorRecoveryRepository({ flush: async () => { flushed++ }, runTransaction: async (stores, mode, run) => {
    if (mode === 'readwrite' && beforeWrite) { const action = beforeWrite; beforeWrite = null; await action() }
    return transact(stores, mode, run)
  } })
  const read = () => transact([...db.objectStoreNames], 'readonly', (tx, done) => {
    const data = {}; done(data)
    for (const store of tx.objectStoreNames) {
      const r = tx.objectStore(store).getAll(); r.onsuccess = () => { data[store] = r.result }
    }
  })
  return { text, day, publications, proofs, repo, read, transact, setBeforeWrite: action => { beforeWrite = action },
    flushed: () => flushed, reopen: async () => { db.close(); db = await connectDatabase({ factory, name }); connections.push(db) } }
}

test('approved unique ranges recover atomically, persist after reopen, preserve all other stores, and leave unmatched publication unattached', async () => {
  const f = await fixture(), before = await f.read()
  const result = await f.repo.recoverExact('u', f.proofs)
  assert.equal(f.flushed(), 1)
  assert.equal(result.recoveredCount, 2)
  assert.deepEqual(result.publicationIds, ['p0', 'p1'])
  await f.reopen()
  const after = await f.read()
  assert.deepEqual(after.publicationAnchors.map(a => a.range), [{ from: 8, to: 12 }, { from: 8, to: 12 }])
  assert.ok(after.publicationAnchors.every(a => a.status === 'attached' && a.sourceRevision === 3))
  assert.ok(!after.publicationAnchors.some(a => a.publicationId === 'unmatched'))
  for (const name of Object.keys(before).filter(name => name !== 'publicationAnchors')) assert.deepEqual(after[name], before[name])
  await assert.rejects(f.repo.recoverExact('u', f.proofs), /already exists/)
  assert.deepEqual(await f.read(), after)
})

test('legacy CRLF and Unicode recover only literal content, without changing legacy storage', async () => {
  const f = await fixture('before 😀\r\ntext after', '😀\r\ntext'), before = await f.read()
  await f.repo.recoverExact('u', f.proofs)
  const after = await f.read()
  assert.deepEqual(after.texts, before.texts)
  assert.deepEqual(after.publicationAnchors.map(a => a.range), [{ from: 8, to: 15 }, { from: 8, to: 15 }])
})

test('backup/live property insertion order differences do not invalidate exact recovery proofs', async () => {
  const f = await fixture()
  await f.transact(['publications'], 'readwrite', tx => {
    for (const publication of f.publications.slice(0, 2)) {
      tx.objectStore('publications').put(Object.fromEntries(Object.entries(publication).reverse()))
    }
  })
  assert.equal((await f.repo.recoverExact('u', f.proofs)).recoveredCount, 2)
})

test('an aborted recovery transaction commits no anchors and changes no source/publication records', async () => {
  const f = await fixture(), before = await f.read()
  const aborting = createPublicationAnchorRecoveryRepository({ flush: async () => {}, runTransaction: (stores, mode, run) =>
    f.transact(stores, mode, (tx, done, fail) => run(tx, result => {
      done(result)
      if (mode === 'readwrite') tx.abort()
    }, fail)) })
  await assert.rejects(aborting.recoverExact('u', f.proofs))
  assert.deepEqual(await f.read(), before)
})

test('wrong owner, modified confirmation, bad hash and revision conflict fail without anchors', async () => {
  const f = await fixture(), before = await f.read()
  await assert.rejects(f.repo.recoverExact('foreign', f.proofs), /owner/)
  for (const change of [{ sourceRevision: 2 }, { range: { from: 7, to: 11 } },
    { sourceFingerprintSha256: '0'.repeat(64) }, { publicationSha256: '0'.repeat(64) }]) {
    await assert.rejects(f.repo.recoverExact('u', [{ ...f.proofs[0], ...change }]))
    assert.deepEqual(await f.read(), before)
  }
})

test('ambiguous and no-exact matches refuse the whole batch', async () => {
  const ambiguous = await fixture('beta beta', 'beta')
  await assert.rejects(ambiguous.repo.recoverExact('u', ambiguous.proofs), /unique exact/)
  assert.equal((await ambiguous.read()).publicationAnchors.length, 0)
  const f = await fixture()
  const unmatched = { ...f.proofs[1], publicationId: 'unmatched', publicationSha256: await hash(JSON.stringify(f.publications[2])) }
  await assert.rejects(f.repo.recoverExact('u', [f.proofs[0], unmatched]), /unique exact/)
  assert.equal((await f.read()).publicationAnchors.length, 0)
})

test('transaction boundary detects revision changes, same-revision content changes, day changes and publication changes', async () => {
  for (const change of ['revision', 'content', 'day', 'publication']) {
    const f = await fixture()
    f.setBeforeWrite(() => f.transact(['texts', 'userDays', 'publications'], 'readwrite', tx => {
      if (change === 'revision') tx.objectStore('texts').put({ ...f.text, revision: 4 })
      if (change === 'content') tx.objectStore('texts').put({ ...f.text, content: 'prefix beta new suffix' })
      if (change === 'day') tx.objectStore('userDays').put({ ...f.day, revision: 5 })
      if (change === 'publication') tx.objectStore('publications').put({ ...f.publications[0], publishedAt: 2 })
    }))
    await assert.rejects(f.repo.recoverExact('u', f.proofs), /revision|changed before commit/)
    assert.equal((await f.read()).publicationAnchors.length, 0)
  }
})

test('same-revision content drift before preparation is rejected by the approved source hash', async () => {
  const f = await fixture()
  await f.transact(['texts'], 'readwrite', tx => tx.objectStore('texts').put({ ...f.text, content: 'prefix beta new suffix' }))
  await assert.rejects(f.repo.recoverExact('u', f.proofs), /differs from approved report/)
  assert.equal((await f.read()).publicationAnchors.length, 0)
})

test('attached exact duplicate rejects atomically; detached duplicate does not block recovery', async () => {
  for (const status of ['attached', 'detached']) {
    const f = await fixture()
    await f.transact(['publications', 'publicationAnchors'], 'readwrite', tx => {
      tx.objectStore('publications').add({ ...f.publications[0], publicationId: 'other' })
      tx.objectStore('publicationAnchors').add({ publicationId: 'other', userId: 'u', sourceType: 'archive', sourceId: 't',
        sourceRevision: 3, coordinateVersion: 1, status, range: status === 'attached' ? { from: 8, to: 12 } : null })
    })
    if (status === 'attached') {
      await assert.rejects(f.repo.recoverExact('u', f.proofs), { name: 'ConstraintError' })
      assert.equal((await f.read()).publicationAnchors.length, 1)
    } else {
      assert.equal((await f.repo.recoverExact('u', f.proofs)).recoveredCount, 2)
      assert.equal((await f.read()).publicationAnchors.length, 3)
    }
  }
})

test('overlapping/nested unique ranges in the same channel are permitted; duplicate IDs are refused', async () => {
  const f = await fixture(), nested = { ...f.publications[0], publicationId: 'nested', snapshot: { content: 'prefix beta' } }
  await f.transact(['publications'], 'readwrite', tx => tx.objectStore('publications').add(nested))
  const proof = { ...f.proofs[0], publicationId: 'nested', range: { from: 1, to: 12 }, publicationSha256: await hash(JSON.stringify(nested)) }
  await assert.rejects(f.repo.recoverExact('u', [f.proofs[0], f.proofs[0]]), /Invalid recovery confirmations/)
  assert.equal((await f.repo.recoverExact('u', [f.proofs[0], proof])).recoveredCount, 2)
})
