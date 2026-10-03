export function dayValueTicks(maximum, minimum = 0) {
  const values = Array.from({ length: 5 }, (_, index) => minimum + (maximum - minimum) * (4 - index) / 4)
  if (minimum <= 0 && maximum >= 0) values.push(0)
  return [...new Set(values)].sort((a, b) => b - a).map(value => ({ value, label: Math.round(value) }))
}

export function dayHourTicks(first, last, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, minute: '2-digit' })
  const ticks = []
  // Local full hours also work for zones with half/quarter-hour UTC offsets.
  for (let timestamp = Math.ceil(first / 60000) * 60000; timestamp <= last; timestamp += 60000) {
    if (formatter.format(timestamp) === '0' || formatter.format(timestamp) === '00') ticks.push(timestamp)
  }
  return ticks.length ? ticks : [...new Set([first, last])]
}
