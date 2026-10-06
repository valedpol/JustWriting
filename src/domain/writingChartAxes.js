export function dayValueTicks(maximum, minimum = 0) {
  const values = Array.from({ length: 5 }, (_, index) => minimum + (maximum - minimum) * (4 - index) / 4)
  if (minimum <= 0 && maximum >= 0) values.push(0)
  return [...new Set(values)].sort((a, b) => b - a).map(value => ({ value, label: Math.round(value) }))
}

export function dayHourTicks(first, last, timeZone, axisWidth = 560, minimumLabelDistance = 44) {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone, minute: '2-digit' })
  const ticks = []
  // Local full hours also work for zones with half/quarter-hour UTC offsets.
  for (let timestamp = Math.ceil(first / 60000) * 60000; timestamp <= last; timestamp += 60000) {
    if (formatter.format(timestamp) === '0' || formatter.format(timestamp) === '00') ticks.push(timestamp)
  }
  // Endpoint labels use the same minute precision as the hourly labels.
  // Keep the actual save times when an endpoint falls within a full-hour minute.
  const endpointMinutes = new Set([first, last].map(timestamp => Math.floor(timestamp / 60000)))
  // Leave a clear gap between labels, using chart coordinates rather than
  // elapsed minutes. The renderer can supply clearance for its actual font.
  const visibleHours = ticks.filter(timestamp => {
    if (endpointMinutes.has(Math.floor(timestamp / 60000)) || first === last) return false
    const fromFirst = (timestamp - first) / (last - first) * axisWidth
    const fromLast = (last - timestamp) / (last - first) * axisWidth
    return fromFirst >= minimumLabelDistance && fromLast >= minimumLabelDistance
  })
  return [...new Set([first, ...visibleHours, last])]
    .sort((a, b) => a - b)
}
