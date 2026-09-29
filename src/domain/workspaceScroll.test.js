import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeWorkspaceWheel } from './workspaceScroll.js'

function fixture(zone, deltaMode = 0) {
  const target = { closest: () => zone === 'navigation' ? {} : null }
  const workspace = { contains: () => zone !== 'header' }
  const scroller = { scrollTop: 50, clientHeight: 600, contains: () => zone === 'content' }
  const event = { target, deltaY: 2, deltaMode, cancelable: true, preventDefault() { this.defaultPrevented = true } }
  return { target, workspace, scroller, event }
}

for (const surface of ['archive metadata', 'settings right whitespace', 'editor padding']) {
  test(`${surface} scrolls the existing content container`, () => {
    const { event, workspace, scroller } = fixture(surface)
    routeWorkspaceWheel(event, workspace, scroller)
    assert.equal(scroller.scrollTop, 52)
    assert.equal(event.defaultPrevented, true)
  })
}
for (const zone of ['content', 'navigation', 'header']) {
  test(`${zone} retains its native behavior without double scrolling`, () => {
    const { event, workspace, scroller } = fixture(zone)
    routeWorkspaceWheel(event, workspace, scroller)
    assert.equal(scroller.scrollTop, 50)
    assert.equal(event.defaultPrevented, undefined)
  })
}
test('line/page units, upward wheel, zoom and missing scroller', () => {
  for (const [mode, distance] of [[1, 32], [2, 1200]]) {
    const { event, workspace, scroller } = fixture('right', mode)
    event.deltaY = -2
    routeWorkspaceWheel(event, workspace, scroller)
    assert.equal(scroller.scrollTop, 50 - distance)
  }
  const { event, workspace, scroller } = fixture('right')
  event.ctrlKey = true
  routeWorkspaceWheel(event, workspace, scroller)
  assert.equal(scroller.scrollTop, 50)
  assert.equal(event.defaultPrevented, undefined)
  routeWorkspaceWheel(event, workspace, null)
})
