import { test } from 'node:test'
import assert from 'node:assert/strict'
import { archiveDateTop, collapseAnchor } from './archiveViewport.js'

test('date follows entry, sticks to reading top and leaves with entry bottom', () => {
  assert.equal(archiveDateTop(120, 800, 40), 120)
  assert.equal(archiveDateTop(-300, 500, 40), 0)
  assert.equal(archiveDateTop(-300, 25, 40), -15)
  assert.equal(archiveDateTop(-500, -20, 40), -60)
})

test('collapse anchors active visible entry, otherwise nearest expanded entry to viewport centre', () => {
  const entries = [
    { textId: 'a', top: -100, bottom: 100 },
    { textId: 'b', top: 180, bottom: 420 },
    { textId: 'c', top: 500, bottom: 900 },
    { textId: 'offscreen', top: 1000, bottom: 1200 },
  ]
  assert.deepEqual(collapseAnchor(entries, 'c', 600), { textId: 'c', top: 500 })
  assert.deepEqual(collapseAnchor(entries, 'a', 600), { textId: 'a', top: 0 })
  for (const id of [null, 'missing', 'offscreen']) {
    assert.deepEqual(collapseAnchor(entries, id, 600), { textId: 'b', top: 180 })
  }
  assert.equal(collapseAnchor([], null, 600), null)
})
