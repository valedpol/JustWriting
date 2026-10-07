import test from 'node:test'
import assert from 'node:assert/strict'
import { stickySelectionPanelTop } from './selectionPanelGeometry.js'

test('measured fractional geometry fits the entire toolbar between calendar and text with clearances', () => {
  const boundary = 298.78, textTop = 350.33, height = 44.20
  const top = stickySelectionPanelTop(boundary, textTop, height)
  assert.ok(top >= boundary + 2)
  assert.ok(top + height <= textTop - 4 + 1e-9)
  assert.ok(Math.abs(top - 302.13) < 1e-9)
})

test('expanded and collapsed boundaries are dynamic; ample space retains preferred inset', () => {
  for (const boundary of [80, 298.78]) {
    assert.equal(stickySelectionPanelTop(boundary, boundary + 100, 44.2), boundary + 8)
  }
})

test('insufficient room or missing visible lines retains boundary fallback', () => {
  assert.equal(stickySelectionPanelTop(100, 120, 44.2), 108)
  assert.equal(stickySelectionPanelTop(100, Infinity, 44.2), 108)
})
