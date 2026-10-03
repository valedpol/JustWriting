export function researchMonth(entries, month) {
  let hasText = false
  let words = 0
  for (const [dayKey, entry] of entries) {
    if (!dayKey.startsWith(month + '-')) continue
    hasText = true
    words += entry.words
  }
  const tail = words % 100
  const noun = tail >= 11 && tail <= 14 ? 'слов' : words % 10 === 1 ? 'слово' : words % 10 >= 2 && words % 10 <= 4 ? 'слова' : 'слов'
  return { hasText, words, tooltip: hasText ? `${words.toLocaleString('ru-RU')} ${noun}` : null }
}
