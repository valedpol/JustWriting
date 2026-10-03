import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaintenanceCoordinator } from './maintenance.js'
import { memoryLocks, memoryStorage } from './maintenanceTestHelpers.js'

const make = () => { const c = createMaintenanceCoordinator({ locks: memoryLocks(), storage: memoryStorage() }); c.registerFlush(async () => {}); return c }
test('maintenance waits for actual shared-lock release before requesting exclusive presence', async () => {
  let finishRelease, releaseStarted, firstShared = true, flushed = false
  const started = new Promise(resolve => { releaseStarted = resolve })
  const locks = memoryLocks({ beforeRelease: async lock => {
    if (lock.mode === 'shared' && firstShared) {
      firstShared = false
      await new Promise(resolve => { finishRelease = resolve; releaseStarted() })
    }
  } })
  const c = createMaintenanceCoordinator({ locks, storage: memoryStorage() })
  c.registerFlush(async () => { flushed = true })
  await c.registerApplication()
  const entering = c.enter()
  await started
  assert.equal(c.status().localPhase, 'draining')
  assert.equal(flushed, false)
  assert.equal((await locks.query()).held[0].mode, 'shared')
  finishRelease()
  const state = await entering
  assert.equal(flushed, true)
  await c.assertReady(state.token)
  await c.exit()
  assert.deepEqual((await locks.query()).held, [{ name: 'just-writing-application-presence', mode: 'shared' }])
  await c.enter()
  await c.exit()
})
test('normal → drain accepted operations/real flush → exclusive maintenance; writes and producers blocked', async () => {
  const c = make(); await c.registerApplication()
  let finish, committed = false, flushCalled = false
  const operation = c.normalOperation(async () => {
    await new Promise(resolve => { finish = resolve })
    await c.applicationWrite(async () => { committed = true })
  })
  await Promise.resolve()
  c.registerFlush(async () => { flushCalled = true; finish(); await operation })
  const state = await c.enter()
  assert.equal(flushCalled, true); assert.equal(committed, true)
  assert.equal(state.active, true); assert.equal(state.pendingWrites, 0)
  await c.assertReady(state.token)
  assert.throws(() => c.assertNormal(), /blocked/)
  await assert.rejects(c.applicationWrite(() => assert.fail('write executed')), /blocked/)
  await assert.rejects(c.assertReady('wrong-token'))
  await c.exit(); await c.applicationWrite(() => { committed = false })
  assert.equal(committed, false)
})
test('failed flush stays blocked; no checkpoint-ready maintenance and no silent resume', async () => {
  const c = make(); await c.registerApplication()
  c.registerFlush(async () => { throw new Error('unsaved editor') })
  await assert.rejects(c.enter(), /unsaved/)
  assert.equal(c.status().active, false); assert.equal(c.status().localPhase, 'failed')
  await assert.rejects(c.applicationWrite(() => assert.fail()), /blocked/)
  await assert.rejects(c.assertReady(c.status().token))
  await c.exit()
})
test('second application tab prevents maintenance; owner lease prevents new app startup', async () => {
  const locks = memoryLocks(), storage = memoryStorage()
  const a = createMaintenanceCoordinator({ locks, storage }), b = createMaintenanceCoordinator({ locks, storage })
  a.registerFlush(async () => {}); b.registerFlush(async () => {})
  await a.registerApplication(); await b.registerApplication()
  await assert.rejects(a.enter(), /close other/)
  await a.exit()
  // Separate clean lifecycle checks shared marker and exclusive lease.
  const otherLocks = memoryLocks(), otherStorage = memoryStorage()
  const owner = createMaintenanceCoordinator({ locks: otherLocks, storage: otherStorage })
  owner.registerFlush(async () => {})
  await owner.registerApplication(); await owner.enter()
  const newcomer = createMaintenanceCoordinator({ locks: otherLocks, storage: otherStorage })
  await assert.rejects(newcomer.registerApplication(), /blocked/)
  await assert.rejects(newcomer.applicationWrite(() => assert.fail()), /blocked/)
  await assert.rejects(newcomer.assertReady(owner.status().token), /owner/)
  await assert.rejects(newcomer.exit(), /owner/)
  await owner.exit()
})
