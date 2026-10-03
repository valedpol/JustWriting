import { dayValueTicks, dayHourTicks } from '../domain/writingChartAxes.js'

const number = (value) => value.toLocaleString('ru-RU')
const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export default function WritingChart({ chart }) {
  const { points, scale, timeZone, sampleCount } = chart
  if (!points.length) return <p className="research-muted">{sampleCount === 1
    ? 'Пока недостаточно данных для темпа письма.'
    : 'Темп письма для этого дня не записывался.'}</p>
  const first = points[0].start ?? points[0].x
  const last = points.at(-1).x
  const low = Math.min(0, ...points.map((point) => point.value))
  const high = Math.max(0, ...points.map((point) => point.value))
  const top = high === low ? high + 1 : high
  const x = (value) => first === last ? 335 : 55 + (value - first) / (last - first) * 560
  const y = (value) => 190 - (value - low) / (top - low) * 155
  const label = (value) => scale === 'day'
    ? new Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit', minute: '2-digit' }).format(value)
    : scale === 'year' ? months[value - 1] : value
  const ticks = scale === 'day' ? dayHourTicks(first, last, timeZone) : points.map((p) => p.x)
  const line = points.length === 1
    ? `${first === last ? x(first) - 3 : x(first)},${y(points[0].value)} ${first === last ? x(last) + 3 : x(last)},${y(points[0].value)}`
    : points.map((point) => `${x(point.x)},${y(point.value)}`).join(' ')
  return <svg className="research-chart" viewBox="0 0 660 235" role="img" aria-label="Темп письма">
    <path d="M55 25V190" className="research-axis" />
    <path d={`M55 ${y(0)}H615`} className="research-axis" />
    {(scale === 'day' ? dayValueTicks(top, low) : [...new Set([low, 0, top])].map((value) => ({ value, label: value })))
      .map(({ value, label }, index) => <text key={index} x="45" y={y(value) + 4} textAnchor="end">{number(label)}</text>)}
    <text x="55" y="16">слов</text>
    <polyline points={line} className="research-line" />
    {ticks.map((value) => <text key={value} x={x(value)} y={y(0) + 24} textAnchor="middle">{label(value)}</text>)}
  </svg>
}
