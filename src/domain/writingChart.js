export function periodScale(period) {
  return period.length === 4 ? 'year' : period.length === 7 ? 'month' : 'day'
}

export function writingChart(data, period, calendarKey) {
  const scale = periodScale(period)
  if (scale === 'day') {
    const entry = data.entries.get(period)
    const samples = entry ? data.samples.filter((s) => s.userDayId === entry.day.userDayId)
      .slice().sort((a, b) => a.timestamp - b.timestamp) : []
    return { scale, timeZone: entry?.day.timeZone ?? 'UTC', sampleCount: samples.length,
      points: samples.slice(1).map((point, i) => ({
        x: point.timestamp, start: samples[i].timestamp, value: point.wordCount - samples[i].wordCount,
      })) }
  }
  const count = scale === 'year'
    ? (period === calendarKey.slice(0, 4) ? Number(calendarKey.slice(5, 7)) : 12)
    : (period === calendarKey.slice(0, 7) ? Number(calendarKey.slice(8, 10)) : new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate())
  const points = Array.from({ length: count }, (_, i) => {
    const key = period + '-' + String(i + 1).padStart(2, '0')
    const value = scale === 'year'
      ? [...data.entries].filter(([day]) => day.startsWith(key + '-')).reduce((sum, [, entry]) => sum + entry.words, 0)
      : data.entries.get(key)?.words ?? 0
    return { x: i + 1, value }
  })
  return { scale, points }
}
