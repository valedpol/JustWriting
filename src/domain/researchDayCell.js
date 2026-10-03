export function researchDayCell(entry) {
  if (!entry) return { hasText: false, reached: false, tooltip: 'Текста нет' }
  const count = entry.words
  const tail = count % 100
  const word = tail >= 11 && tail <= 14 ? 'слов' : count % 10 === 1 ? 'слово' : count % 10 >= 2 && count % 10 <= 4 ? 'слова' : 'слов'
  return {
    hasText: true,
    reached: entry.day.dailyWordGoal != null && entry.day.goalReached === true,
    tooltip: entry.day.dailyWordGoal != null
      ? `${count.toLocaleString('ru-RU')} / ${entry.day.dailyWordGoal.toLocaleString('ru-RU')} слов`
      : `${count.toLocaleString('ru-RU')} ${word}`,
  }
}
