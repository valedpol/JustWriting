// Explicit console-only maintenance. No entry on startup. Web Locks exclude
// other application documents and fence every ordinary write transaction.
export const PRESENCE_LOCK = 'just-writing-application-presence'
export const WRITE_LOCK = 'just-writing-ordinary-writes'
const MARKER = 'just-writing-explicit-maintenance'

export function createMaintenanceCoordinator({ locks, storage, id = crypto.randomUUID() } = {}) {
  let phase = 'normal', presenceRelease, exclusiveRelease, writesRelease, ownerToken
  let transition, drainFailure, presenceRegistration
  const pending = new Set(), flushers = new Set(), listeners = new Set()
  const marker = () => storage ? JSON.parse(storage.getItem(MARKER) || 'null') : null
  const emit = () => { for (const fn of listeners) fn() }
  const blocked = () => phase !== 'normal' || !!marker()
  const assertNormal = () => { if (blocked()) throw new Error('Maintenance: normal application operations are blocked') }
  const hold = (name, mode) => new Promise((resolve, reject) => {
    if (!locks) { reject(new Error('Web Locks are required for maintenance')); return }
    const request = locks.request(name, { mode, ifAvailable: true }, lock => {
      if (!lock) { reject(new Error(`Maintenance lock unavailable: ${name}; close other application tabs`)); return }
      // Resolving the callback's promise only signals release. The request
      // promise settles after the browser has actually released the lock.
      return new Promise(release => resolve(async () => { release(); await request }))
    })
    request.catch(reject)
  })
  async function registerApplication() {
    assertNormal()
    if (!presenceRelease) {
      presenceRegistration ??= hold(PRESENCE_LOCK, 'shared').then(release => { presenceRelease = release })
      try { await presenceRegistration } finally { presenceRegistration = undefined }
    }
    try { assertNormal() } catch (error) { await presenceRelease?.(); presenceRelease = undefined; throw error }
  }
  function track(task) {
    pending.add(task)
    task.then(() => pending.delete(task), error => { pending.delete(task); if (phase === 'draining') drainFailure = error })
    return task
  }
  function applicationWrite(run) {
    // Draining admits storage operations of previously accepted editor queues.
    // New producer operations are fenced by assertNormal at their entry points.
    if (phase === 'maintenance' || phase === 'failed' || (marker() && !ownerToken)) return Promise.reject(new Error('Maintenance: database write blocked'))
    const task = (async () => {
      const execute = () => {
        if (phase === 'maintenance' || phase === 'failed' || (marker() && !ownerToken)) throw new Error('Maintenance: database write blocked')
        return run()
      }
      if (!locks) return execute()
      return locks.request(WRITE_LOCK, { mode: 'shared', ifAvailable: true }, lock => {
        if (!lock) throw new Error('Maintenance: write lock unavailable')
        return execute()
      })
    })()
    return track(task)
  }
  function normalOperation(run) { assertNormal(); return track(Promise.resolve().then(run)) }
  async function flushPending() {
    for (const drain of flushers) await drain()
    while (pending.size) {
      const results = await Promise.allSettled([...pending])
      const failure = results.find(r => r.status === 'rejected')
      if (failure) throw failure.reason
    }
  }
  function enter() {
    if (transition) return transition
    if (phase === 'maintenance') return Promise.resolve(status())
    assertNormal()
    if (!locks || !storage || !presenceRelease || !flushers.size) return Promise.reject(new Error('Enter from the ready application tab with Web Locks/localStorage available'))
    drainFailure = undefined; phase = 'draining'; ownerToken = crypto.randomUUID()
    transition = (async () => {
      try {
        emit()
        await presenceRelease(); presenceRelease = undefined
        exclusiveRelease = await hold(PRESENCE_LOCK, 'exclusive')
        storage.setItem(MARKER, JSON.stringify({ token: ownerToken, owner: id, phase: 'draining', enteredAt: Date.now() }))
        await flushPending()
        if (drainFailure) throw drainFailure
        writesRelease = await hold(WRITE_LOCK, 'exclusive')
        if (pending.size) throw new Error('Pending operations remain')
        phase = 'maintenance'
        storage.setItem(MARKER, JSON.stringify({ ...marker(), phase }))
        emit(); return status()
      } catch (error) {
        // Fail closed. No checkpoint may be approved in this state. Explicit
        // exit is required; never silently resume writes following failed flush.
        phase = 'failed'; if (marker()?.owner === id) storage.setItem(MARKER, JSON.stringify({ ...marker(), phase })); emit(); throw error
      } finally { transition = undefined }
    })()
    return transition
  }
  async function exit() {
    if (transition) throw new Error('Maintenance transition is still pending')
    const m = marker()
    if (m && m.owner !== id) throw new Error('Exit from the maintenance owner application tab')
    await writesRelease?.(); writesRelease = undefined
    await exclusiveRelease?.(); exclusiveRelease = undefined
    if (m) storage.removeItem(MARKER)
    ownerToken = undefined; phase = 'normal'
    if (locks) await registerApplication()
    emit(); return status()
  }
  function status() {
    const m = marker()
    return { phase: m?.phase ?? phase, localPhase: phase, active: (m?.phase ?? phase) === 'maintenance', token: m?.token ?? ownerToken,
      pendingWrites: pending.size, owner: m?.owner, producersBlocked: blocked() }
  }
  async function assertReady(token) {
    const m = marker(), state = status()
    if (!m || phase !== 'maintenance' || !state.active || m.owner !== id ||
      !ownerToken || ownerToken !== token || m.token !== token || pending.size) {
      throw new Error('Maintenance owner is not active/idle or token differs')
    }
    const query = await locks?.query()
    if (![PRESENCE_LOCK, WRITE_LOCK].every(name => query?.held.some(l => l.name === name && l.mode === 'exclusive'))) throw new Error('Maintenance exclusive locks are not held')
    if (JSON.stringify(marker()) !== JSON.stringify(m)) throw new Error('Maintenance changed during verification')
    return state
  }
  return { registerApplication, enter, exit, status, assertReady, assertNormal, blocked, applicationWrite, normalOperation, flushPending,
    assertSchemaWrite() { if (blocked()) throw new Error('Maintenance: schema migration blocked') },
    registerFlush(fn) { flushers.add(fn); return () => flushers.delete(fn) },
    hasRegisteredFlush() { return flushers.size > 0 },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    trackAccepted: track,
  }
}

// Vite query/HMR URLs can instantiate this module more than once. Share the
// live coordinator per JS realm, so Console, storage and editors use the same
// owner token, presence lease, write fence and registered flush callbacks.
const SINGLETON = Symbol.for('just-writing.maintenance.v1')
if (!Object.hasOwn(globalThis, SINGLETON)) {
  Object.defineProperty(globalThis, SINGLETON, { value: createMaintenanceCoordinator({
    locks: globalThis.navigator?.locks,
    storage: globalThis.localStorage,
  }) })
}
export const maintenance = globalThis[SINGLETON]
