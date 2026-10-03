import { useEffect, useState } from 'react'
import { loadResearch } from './storage/researchRepository.js'
import { researchData } from './domain/research.js'
import './Research.css'
import { writingChart, periodScale } from './domain/writingChart.js'
import { localDayKey } from './domain/writingDay.js'
import WritingChart from './components/WritingChart.jsx'
import ResearchDayCell from './components/ResearchDayCell.jsx'
import ResearchMonth from './components/ResearchMonth.jsx'

const number = (value) => value.toLocaleString('ru-RU')
const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const dateLabel = (key) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(key + 'T12:00:00Z'))
const plural = (n, one, few, many) => n % 100 >= 11 && n % 100 <= 14 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many

export default function Research({ userId, flush }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  useEffect(() => {
    if (!userId) return
    let stopped = false
    let reading = false
    const refresh = async () => {
      if (reading) return
      reading = true
      try {
        await flush()
        const snapshot = await loadResearch(userId)
        if (!stopped && snapshot.profile) { setData({ ...researchData(snapshot, Date.now()), calendarKey: localDayKey(Date.now(), snapshot.profile.timeZone) }); setError('') }
      } catch (failure) { if (!stopped) setError(failure.message) }
      finally { reading = false }
    }
    refresh()
    const timer = window.setInterval(refresh, 10000)
    window.addEventListener('focus', refresh)
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', refresh) }
    // flush only drains the hook's stable queue ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])
  if (!data) return <div className="research-content"><p role="status">{error || 'Загружаю…'}</p></div>
  const period = selected && selected <= data.calendarKey ? selected : data.currentKey
  const scale = periodScale(period)
  const year = period.slice(0, 4)
  const month = period.length >= 7 ? period.slice(0, 7)
    : year === data.calendarKey.slice(0, 4) ? data.calendarKey.slice(0, 7) : year + '-01'
  const key = scale === 'day' ? period : null
  const earliest = [...data.entries.keys(), data.currentKey].sort()[0]
  const years = Array.from({ length: Number(data.currentKey.slice(0, 4)) - Number(earliest.slice(0, 4)) + 1 }, (_, i) => String(Number(earliest.slice(0, 4)) + i))
  const monthCount = year === data.currentKey.slice(0, 4) ? Number(data.currentKey.slice(5, 7)) : 12
  const dayCount = new Date(Date.UTC(Number(year), Number(month.slice(5, 7)), 0)).getUTCDate()
  const entry = data.entries.get(key)
  const chart = writingChart(data, period, data.calendarKey)
  const periodWords = scale === 'day' ? entry?.words ?? 0 : chart.points.reduce((sum, point) => sum + point.value, 0)
  const heading = scale === 'day' ? dateLabel(period) : scale === 'year' ? period
    : months[Number(period.slice(5, 7)) - 1] + ' ' + year
  return <div className="research-content">
    {error ? <p role="alert">{error}</p> : null}
    <div className="research-totals">
      <div><strong>{number(data.writingDays)}</strong><span>{plural(data.writingDays, 'день письма', 'дня письма', 'дней письма')}</span></div>
      <div><strong>{number(data.totalWords)}</strong><span>слов</span></div>
      <div><strong>{number(data.streak)}</strong><span>{plural(data.streak, 'день подряд', 'дня подряд', 'дней подряд')}</span></div>
    </div>
    <nav className="research-time" aria-label="Выбор даты">
      <div className="research-time-row" role="group" aria-label="Годы"><div>{years.map((value) => <button key={value} aria-pressed={value === year} onClick={() => setSelected(value)}>{value}</button>)}</div></div>
      <div className="research-time-row" role="group" aria-label="Месяцы"><div>{months.slice(0, monthCount).map((label, i) => {
        const value = year + '-' + String(i + 1).padStart(2, '0')
        return <ResearchMonth key={value} entries={data.entries} month={value} label={label} selected={scale !== 'year' && value === month} onSelect={() => setSelected(value)} />
      })}</div></div>
      <div className="research-time-row research-days-row" role="group" aria-label="Дни"><div>{Array.from({ length: dayCount }, (_, i) => {
        const value = month + '-' + String(i + 1).padStart(2, '0')
        return <ResearchDayCell key={value} entry={data.entries.get(value)} day={i + 1}
          label={dateLabel(value)} disabled={value > data.currentKey} selected={value === key}
          onSelect={() => setSelected(value)} />
      })}</div></div>
    </nav>
    <section className="research-day">
      <h1>{heading} {key === data.currentKey ? <small>сегодня</small> : null}</h1>
      <p>{scale === 'day' && !entry ? 'Текста нет' : `${number(periodWords)} слов`}</p>
      <h2>Темп письма</h2>
      <WritingChart chart={chart} />
    </section>
  </div>
}
