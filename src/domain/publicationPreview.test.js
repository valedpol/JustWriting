import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { publicationPreview } from './publicationPreview.js'

function fixture() {
  const dom = new JSDOM('<div id="snapshot"><div class="readonly-document"><p><strong>abcdefghijklmnopqrst</strong><em>uvwxyz0123456789ABCD</em><u>EFGHIJKLMNOPQRSTUVWX</u></p></div></div>')
  const container = dom.window.document.querySelector('#snapshot')
  let width = 10
  const rect = index => ({ top: Math.floor(index / width) * 20, bottom: Math.floor(index / width) * 20 + 20, height: 20 })
  const start = range => {
    const walker = dom.window.document.createTreeWalker(container, 4)
    let offset = 0
    while (walker.nextNode()) {
      if (walker.currentNode === range.startContainer) return offset + range.startOffset
      offset += walker.currentNode.length
    }
    throw new Error('Expected a measured text range')
  }
  dom.window.Range.prototype.getClientRects = function () {
    const first = start(this), last = first + this.endOffset - this.startOffset - 1
    const rows = []
    for (let row = Math.floor(first / width); row <= Math.floor(last / width); row++) rows.push(rect(row * width))
    return rows
  }
  dom.window.Range.prototype.getBoundingClientRect = function () { return rect(start(this)) }
  return { dom, container, setWidth(value) { width = value } }
}

test('six visual lines render the whole snapshot once without artificial ellipsis', () => {
  const f = fixture()
  try {
    const { head, tail } = publicationPreview(f.container)
    assert.equal(tail, null)
    assert.equal(head.textContent, f.container.textContent)
    assert.equal(head.innerHTML, f.container.innerHTML)
  } finally { f.dom.window.close() }
})

test('long wrapped paragraph previews first three and last three visual lines, preserving B/I/U and leaving the snapshot intact', () => {
  const f = fixture()
  try {
    f.setWidth(6)
    const before = f.container.innerHTML
    const { head, tail } = publicationPreview(f.container)
    assert.equal(head.textContent, f.container.textContent.slice(0, 18))
    assert.equal(tail.textContent, f.container.textContent.slice(-18))
    assert.equal(head.querySelector('strong').textContent, f.container.textContent.slice(0, 18))
    assert.equal(tail.querySelector('u').textContent, f.container.textContent.slice(-18))
    f.setWidth(8)
    const wider = publicationPreview(f.container)
    assert.equal(wider.head.textContent, f.container.textContent.slice(0, 24))
    assert.ok(wider.head.querySelector('em'), 'formatting across a line cut survives')
    assert.equal(wider.tail.textContent, f.container.textContent.slice(-20)) // last row is partial
    assert.equal(f.container.innerHTML, before)
    f.setWidth(10)
    assert.equal(publicationPreview(f.container).tail, null, 'resize back to six lines removes the split')
  } finally { f.dom.window.close() }
})

test('paragraph boundaries do not add empty duplicate paragraphs to either excerpt', () => {
  const dom = new JSDOM(`<div id="snapshot"><div class="readonly-document">${Array.from({ length: 8 }, (_, i) => `<p><strong>row${i}</strong></p>`).join('')}</div></div>`)
  try {
    const container = dom.window.document.querySelector('#snapshot')
    const paragraphs = [...container.querySelectorAll('p')]
    const rect = node => {
      const top = paragraphs.indexOf(node.parentElement.closest('p')) * 31
      return { top, bottom: top + 23, height: 23 }
    }
    dom.window.Range.prototype.getClientRects = function () { return [rect(this.startContainer)] }
    dom.window.Range.prototype.getBoundingClientRect = function () { return rect(this.startContainer) }
    const { head, tail } = publicationPreview(container)
    assert.deepEqual([...head.querySelectorAll('p')].map(node => node.textContent), ['row0', 'row1', 'row2'])
    assert.deepEqual([...tail.querySelectorAll('p')].map(node => node.textContent), ['row5', 'row6', 'row7'])
  } finally { dom.window.close() }
})

test('compact profile preview contains only the first two visual lines, preserves marks and never mutates the snapshot', () => {
  const f = fixture()
  try {
    const before = f.container.innerHTML
    f.setWidth(14)
    const compact = publicationPreview(f.container, { compact: true })
    assert.equal(compact.head.textContent, f.container.textContent.slice(0, 28))
    assert.equal(compact.tail, null)
    assert.equal(compact.truncated, true)
    assert.ok(compact.head.querySelector('strong'))
    assert.ok(compact.head.querySelector('em'))
    f.setWidth(25)
    assert.ok(publicationPreview(f.container, { compact: true }).head.querySelector('u'))
    f.setWidth(30)
    const short = publicationPreview(f.container, { compact: true })
    assert.equal(short.head.textContent, f.container.textContent)
    assert.equal(short.truncated, undefined, 'two lines fit without an artificial ellipsis')
    assert.equal(short.tail, null)
    assert.equal(f.container.innerHTML, before)
    f.setWidth(6)
    assert.ok(publicationPreview(f.container).tail, 'default owner/feed preview still uses 3+3')
  } finally { f.dom.window.close() }
})
