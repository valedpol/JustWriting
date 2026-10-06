import { dayValueTicks, dayHourTicks } from '../domain/writingChartAxes.js'
import { useLayoutEffect, useRef, useState } from 'react'

const number = (value) => value.toLocaleString('ru-RU')
const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export default function WritingChart({ chart }) {
  const { points, scale, timeZone, sampleCount } = chart
  const chartElement = useRef(null)
  const [labelClearance, setLabelClearance] = useState(44)
  const hasPoints = points.length > 0
  useLayoutEffect(() => {
    const element = chartElement.current
    if (!element || scale !== 'day') return
    // SVG coordinates scale with width; keep the rendered label font the same
    // size as the word-count caption outside the SVG.
    const measure = () => {
      const width = element.getBoundingClientRect().width
      if (width) {
        const ratio = 660 / width
        element.style.setProperty('--chart-label-scale', ratio)
        const fontSize = parseFloat(getComputedStyle(element.ownerDocument.documentElement).fontSize) || 16
        // Inward HH:mm label + half a centred hour label + breathing room.
        setLabelClearance(Math.max(44, (fontSize * 0.85 * 3.2 + 8) * ratio))
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [scale, hasPoints])
  if (!points.length) return <p className="research-muted">{sampleCount === 1
    ? 'Пока недостаточно данных для темпа письма.'
    : 'Темп письма для этого дня не записывался.'}</p>
  const first = points[0].start ?? points[0].x
  const last = points.at(-1).x
  const low = Math.min(0, ...points.map((point) => point.value))
  const high = Math.max(0, ...points.map((point) => point.value))
  const top = high === low ? high + 1 : high
  const axisWidth = 560
  const x = (value) => first === last ? 335 : 55 + (value - first) / (last - first) * axisWidth
  const y = (value) => 190 - (value - low) / (top - low) * 155
  const label = (value) => scale === 'day'
    ? new Intl.DateTimeFormat('ru-RU', { timeZone, hour: '2-digit',
      ...(value === first || value === last ? { minute: '2-digit' } : {}) }).format(value)
    : scale === 'year' ? months[value - 1] : value
  const ticks = scale === 'day' ? dayHourTicks(first, last, timeZone, axisWidth, labelClearance) : points.map((p) => p.x)
  const line = points.length === 1
    ? `${first === last ? x(first) - 3 : x(first)},${y(points[0].value)} ${first === last ? x(last) + 3 : x(last)},${y(points[0].value)}`
    : points.map((point) => `${x(point.x)},${y(point.value)}`).join(' ')
  return <svg ref={chartElement} className={`research-chart${scale === 'day' ? ' research-chart-day' : ''}`} viewBox="0 0 660 235" role="img" aria-label="Темп письма">
    <path d="M55 25V190" className="research-axis" />
    <path d={`M55 ${y(0)}H615`} className="research-axis" />
    {(scale === 'day' ? dayValueTicks(top, low) : [...new Set([low, 0, top])].map((value) => ({ value, label: value })))
      .map(({ value, label }, index) => <text key={index} x="45" y={y(value) + 4} textAnchor="end">{number(label)}</text>)}
    <text x="55" y="16">слов</text>
    <polyline points={line} className="research-line" />
    {ticks.map((value) => <text className="research-time-tick" key={value} x={x(value)} y={y(0) + 24}
      textAnchor={scale === 'day' && first !== last ? value === first ? 'start' : value === last ? 'end' : 'middle' : 'middle'}>{label(value)}</text>)}
    {scale === 'day' ? <text x="625" y={y(0)} dominantBaseline="middle" textAnchor="start">Время</text> : null}
  </svg>
}
