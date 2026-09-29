import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editTime } from './timeMask.js'

test('select all and replace, paste, permanent colon and sequential entry', () => {
  assert.deepEqual(editTime('00:00', 0, 5, '23:59'), { value: '23:59', cursor: 5 })
  assert.equal(editTime('00:00', 0, 5, '0100').value, '01:00')
  let state = editTime('12:34', 0, 5, '0')
  for (const digit of ['1', '0', '0']) state = editTime(state.value, state.cursor, state.cursor, digit)
  assert.equal(state.value, '01:00')
  assert.equal(editTime('12:34', 0, 5, '').value, '__:__')
})

test('Backspace and Delete cross colon without removing it or moving digits', () => {
  assert.deepEqual(editTime('12:34', 3, 3, '', 'backward'), { value: '1_:34', cursor: 1 })
  assert.deepEqual(editTime('12:34', 2, 2, '', 'forward'), { value: '12:_4', cursor: 3 })
  assert.equal(editTime('12:34', 1, 4, '', 'backward').value, '1_:_4')
})

test('syntax only: 12:01 is valid, invalid 24-hour values and letters rejected', () => {
  assert.equal(editTime('00:00', 0, 5, '12:01').value, '12:01')
  for (const input of ['24:00', '23:60', '99:99', 'text', '12345']) {
    assert.equal(editTime('00:00', 0, 5, input), null)
  }
})
