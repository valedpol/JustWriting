import test from 'node:test'
import assert from 'node:assert/strict'
import { wordCountNoun } from './wordCount.js'

test('publication word noun follows Russian units, teens, tens and hundreds', () => {
  for (const [count, expected] of [
    [0, 'слов'], [1, 'слово'], [2, 'слова'], [3, 'слова'], [4, 'слова'], [5, 'слов'],
    [10, 'слов'], [11, 'слов'], [12, 'слов'], [14, 'слов'], [15, 'слов'], [20, 'слов'],
    [21, 'слово'], [22, 'слова'], [24, 'слова'], [25, 'слов'],
    [101, 'слово'], [104, 'слова'], [111, 'слов'], [114, 'слов'], [121, 'слово'],
    [132, 'слова'], [332, 'слова'], [1001, 'слово'], [1002, 'слова'], [1011, 'слов'],
  ]) assert.equal(wordCountNoun(count), expected, `${count} words`)
})
