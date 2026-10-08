export function getWordCount(value) {
  if (!value || !value.trim()) {
    return 0
  }

  return value
    .replace(/\*\*|__|\*|_|<u>|<\/u>|[-#•*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length
}

export function wordCountNoun(count) {
  const tail = count % 100
  return tail >= 11 && tail <= 14 ? 'слов' : count % 10 === 1 ? 'слово' : count % 10 >= 2 && count % 10 <= 4 ? 'слова' : 'слов'
}
