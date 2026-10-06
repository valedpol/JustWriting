export const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
export const calendarDateLabel = key => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(key + 'T12:00:00Z'))
export function periodLabel(period) {
  return period.length === 4 ? period : period.length === 7 ? months[Number(period.slice(5, 7)) - 1] + ' ' + period.slice(0, 4) : calendarDateLabel(period)
}
