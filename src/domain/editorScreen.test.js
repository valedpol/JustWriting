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
