import ResearchDayCell from './ResearchDayCell.jsx'
import { createPortal } from 'react-dom'
import ResearchMonth from './ResearchMonth.jsx'
import { periodScale } from '../domain/writingChart.js'
import './ArchiveCalendar.css'

import { months, calendarDateLabel } from '../domain/calendarPeriod.js'

export default function ArchiveCalendar({ entries, period, currentKey, calendarKey = currentKey, onSelect, yearHost }) {
  const scale = periodScale(period)
  const year = period.slice(0, 4)
  const month = period.length >= 7 ? period.slice(0, 7)
    : year === calendarKey.slice(0, 4) ? calendarKey.slice(0, 7) : year + '-01'
  const key = scale === 'day' ? period : null
  const earliest = [...entries.keys(), currentKey].sort()[0]
  const years = Array.from({ length: Number(currentKey.slice(0, 4)) - Number(earliest.slice(0, 4)) + 1 }, (_, i) => String(Number(earliest.slice(0, 4)) + i))
  const monthCount = year === currentKey.slice(0, 4) ? Number(currentKey.slice(5, 7)) : 12
  const dayCount = new Date(Date.UTC(Number(year), Number(month.slice(5, 7)), 0)).getUTCDate()
  const yearRow = <div className="research-time-row" role="group" aria-label="Годы"><div>{years.map((value) => <ResearchMonth key={value} entries={entries} month={value} label={value} selected={value === year} onSelect={() => onSelect(value)} />)}</div></div>
  return (
    <nav className="research-time" aria-label="Выбор даты">
      {yearHost ? createPortal(yearRow, yearHost) : yearRow}
      <div className="research-time-row" role="group" aria-label="Месяцы"><div>{months.slice(0, monthCount).map((label, i) => {
        const value = year + '-' + String(i + 1).padStart(2, '0')
        return <ResearchMonth key={value} entries={entries} month={value} label={label} selected={scale !== 'year' && value === month} onSelect={() => onSelect(value)} />
      })}</div></div>
      <div className="research-time-row research-days-row" role="group" aria-label="Дни"><div>{Array.from({ length: dayCount }, (_, i) => {
        const value = month + '-' + String(i + 1).padStart(2, '0')
        return <ResearchDayCell key={value} entry={entries.get(value)} day={i + 1}
          label={calendarDateLabel(value)} disabled={value > currentKey} selected={value === key}
          onSelect={() => onSelect(value)} />
      })}</div></div>
    </nav>
  )
}
