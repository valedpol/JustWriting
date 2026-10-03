import test from 'node:test'
import assert from 'node:assert/strict'
import { bytesHash, downloadFile } from './files.js'

test('file SHA-256 uses exact UTF-8 bytes, including trailing newlines', async () => {
  assert.equal(await bytesHash(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.notEqual(await bytesHash(new TextEncoder().encode('abc\n')), await bytesHash(new TextEncoder().encode('abc')))
})

test('explicit download preserves filename and bytes and leaves URL revocation to caller', () => {
  const previous = globalThis.document, link = { clicks: 0, click() { this.clicks++ } }
  globalThis.document = { createElement(tag) { assert.equal(tag, 'a'); return link } }
  let receipt
  try {
    receipt = downloadFile(new Blob(['literal\n']), 'backup.json')
    assert.equal(receipt.filename, 'backup.json'); assert.equal(link.download, receipt.filename)
    assert.equal(link.href, receipt.url); assert.equal(link.clicks, 1); assert.match(receipt.url, /^blob:/)
  } finally {
    if (receipt) URL.revokeObjectURL(receipt.url)
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous
  }
})
