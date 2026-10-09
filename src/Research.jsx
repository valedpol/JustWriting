import { useEffect, useState } from 'react'
import { loadResearch } from './storage/researchRepository.js'
import { listOwnPublications } from './storage/publicationRepository.js'
import { researchData } from './domain/research.js'
import './Research.css'
import { writingChart, periodScale } from './domain/writingChart.js'
import { localDayKey } from './domain/writingDay.js'
import WritingChart from './components/WritingChart.jsx'
import ArchiveCalendar from './components/ArchiveCalendar.jsx'
import { periodLabel } from './domain/calendarPeriod.js'
import ResearchTotals from './components/ResearchTotals.jsx'
import { createLastVerifiedBackupStore } from './backup/lastVerifiedBackup.js'

export default function Research({ userId, flush }) {
  const [backupStore] = useState(() => createLastVerifiedBackupStore())
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
        const [snapshot, publicationCounts] = await Promise.all([
          loadResearch(userId),
          Promise.all(['profile', 'feed'].map(async channel => [channel, (await listOwnPublications(userId, channel)).length])).then(Object.fromEntries),
        ])
        if (!stopped && snapshot.profile) { setData({ ...researchData(snapshot, Date.now()), publicationCounts, backupCount: backupStore.read() ? 1 : 0, calendarKey: localDayKey(Date.now(), snapshot.profile.timeZone) }); setError('') }
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
  const key = scale === 'day' ? period : null
  const entry = data.entries.get(key)
  const chart = writingChart(data, period, data.calendarKey)
  const periodWords = scale === 'day' ? entry?.words ?? 0 : chart.points.reduce((sum, point) => sum + point.value, 0)
  const heading = periodLabel(period)
  return <div className="research-content">
    {error ? <p role="alert">{error}</p> : null}
    <ResearchTotals data={data} backupCount={data.backupCount} />
    <ArchiveCalendar entries={data.entries} period={period} currentKey={data.currentKey} calendarKey={data.calendarKey} onSelect={setSelected} />
    <section className="research-day">
      <div className="research-day-heading">
        <div className="research-day-metadata">
          <h1>{heading} {key === data.currentKey ? <small>сегодня</small> : null}</h1>
          <p>{scale === 'day' && !entry ? 'Текста нет' : `${periodWords.toLocaleString('ru-RU')} слов`}</p>
        </div>
        <h2>Темп письма</h2>
      </div>
      <WritingChart chart={chart} />
    </section>
  </div>
}
