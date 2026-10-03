import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editorScreenReducer as reduce, initialScreen, SCREEN_MODES as modes } from './editorScreen.js'

test('archive rejects all writing transitions, including a delayed editor event', () => {
  for (const mode of [modes.interface, modes.standard, modes.wide]) {
    const writing = reduce(initialScreen, { type: 'mode', mode })
    const archive = reduce(writing, { type: 'section', section: 'archive' })
    assert.deepEqual(archive, { section: 'archive', screenMode: modes.interface })
    for (const delayedMode of Object.values(modes)) {
      assert.equal(reduce(archive, { type: 'mode', mode: delayedMode }), archive)
    }
  }
})

test('returning to today requires explicit navigation and starts in interface', () => {
  const archive = reduce(initialScreen, { type: 'section', section: 'archive' })
  const today = reduce(archive, { type: 'section', section: 'today' })
  assert.deepEqual(today, initialScreen)
  const standard = reduce(today, { type: 'mode', mode: modes.standard })
  const wide = reduce(standard, { type: 'mode', mode: modes.wide })
  assert.equal(wide.section, 'today')
  assert.equal(wide.screenMode, modes.wide)
  assert.deepEqual(reduce(wide, { type: 'mode', mode: modes.interface }), initialScreen)
})

test('Research opens in interface, rejects writing and exits explicitly to today', () => {
  const research = reduce({ section: 'today', screenMode: modes.wide }, { type: 'section', section: 'research' })
  assert.deepEqual(research, { section: 'research', screenMode: modes.interface })
  assert.equal(reduce(research, { type: 'mode', mode: modes.standard }), research)
  assert.deepEqual(reduce(research, { type: 'section', section: 'today' }), initialScreen)
})

test('timer shortcut composes existing section and mode transitions from every interface page', () => {
  for (const section of ['research', 'settings', 'archive', 'today']) {
    const before = { section, screenMode: modes.interface }
    const today = section === 'today' ? before : reduce(before, { type: 'section', section: 'today' })
    const writing = reduce(today, { type: 'mode', mode: modes.standard })
    assert.deepEqual(writing, { section: 'today', screenMode: modes.standard })
    assert.deepEqual(before, { section, screenMode: modes.interface })
  }
})
