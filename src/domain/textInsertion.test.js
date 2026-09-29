import { test } from 'node:test'
import assert from 'node:assert/strict'
import { insertedText } from './textInsertion.js'

test('boundary routing extracts insertion, paste or composition without moving old content', () => {
  assert.equal(insertedText('Старый текст', 'Старый текст новый'), ' новый')
  assert.equal(insertedText('Старый текст', 'Старый новый текст'), 'новый ')
  assert.equal(insertedText('Старый текст', 'Старый текс'), '')
  assert.equal(insertedText('Старый текст', 'Вставка'), 'Вставка')
  assert.equal(insertedText('До ', 'До 日本語'), '日本語')
})
