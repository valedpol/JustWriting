import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { listReaderFeedPublications, deletePublication } from '../storage/publicationRepository.js'
import { loadDisclosedAuthorName } from '../storage/publicIdentityRepository.js'
import PublicationView from './PublicationView.jsx'
import './ReaderFeed.css'

const readerApi = { list: listReaderFeedPublications, name: loadDisclosedAuthorName, remove: deletePublication }

const textCountNoun = count => count % 100 >= 11 && count % 100 <= 14 ? 'текстов' : count % 10 === 1 ? 'текст' : count % 10 >= 2 && count % 10 <= 4 ? 'текста' : 'текстов'

export default function ReaderFeed({ userId, metadataHost, statusHost, api = readerApi }) {
  const [records, setRecords] = useState(null), [error, setError] = useState('')
  const [filter, setFilter] = useState(null)
  const [availableNames, setAvailableNames] = useState(new Set()), [names, setNames] = useState(new Map())
  const live = useRef(false), generation = useRef(0)
  useEffect(() => {
    if (!userId) return
    live.current = true
    const reload = async () => {
      const request = ++generation.current
      try {
        const items = await api.list(userId)
        const authors = [...new Set(items.filter(item => item.author?.allowNameDisclosure).map(item => item.author.publicId))]
        const availability = await Promise.all(authors.map(async publicId => {
          try { return await api.name(publicId) ? publicId : null } catch { return null }
        }))
        if (!live.current || request !== generation.current) return
        setRecords(items); setAvailableNames(new Set(availability.filter(Boolean))); setNames(new Map()); setError('')
      } catch {
        if (live.current && request === generation.current) setError('Не удалось загрузить Ленту. Откройте её снова.')
      }
    }
    reload()
    window.addEventListener('focus', reload)
    return () => { live.current = false; window.removeEventListener('focus', reload) }
  }, [api, userId])
  const disclose = async publicId => {
    if (names.has(publicId)) {
      setNames(previous => { const next = new Map(previous); next.delete(publicId); return next })
      return
    }
    const request = generation.current
    let name = null
    try { name = await api.name(publicId) } catch { /* Unavailable names stay private. */ }
    if (!live.current || request !== generation.current) return
    if (name) setNames(previous => new Map(previous).set(publicId, name))
    else setAvailableNames(previous => { const next = new Set(previous); next.delete(publicId); return next })
  }
  const remove = async publicationId => {
    // Presentation is not authorization: the existing repository checks owner.
    await api.remove(userId, publicationId)
    ++generation.current
    if (live.current) setRecords(previous => previous.filter(item => item.publicationId !== publicationId))
  }
  const author = record => <>
    {record.isOwn ? <span className="reader-own-marker" role="img" aria-label="Моя публикация">●</span> : null}
    {record.author ? <>
      <button type="button" className="reader-author-name" onClick={() => setFilter({ publicId: record.author.publicId, label: record.author.displayName })}>{record.author.displayName}</button>
      {record.author.allowNameDisclosure && availableNames.has(record.author.publicId)
        ? <button type="button" className="reader-author-reveal" aria-label={names.has(record.author.publicId) ? 'Скрыть имя автора' : 'Раскрыть имя автора'} aria-expanded={names.has(record.author.publicId)} onClick={() => disclose(record.author.publicId)}>›</button> : null}
      {names.has(record.author.publicId) ? <span className="reader-author-disclosed">{names.get(record.author.publicId)}</span> : null}
    </> : <span>Автор</span>}
  </>
  const filterLabel = filter ? records?.find(record => record.author?.publicId === filter.publicId)?.author?.displayName ?? filter.label : ''
  const heading = filter ? <span className="reader-feed-heading">{filterLabel}<button type="button" aria-label="Сбросить фильтр автора" onClick={() => setFilter(null)}>×</button></span> : null
  const visible = records === null ? null : filter ? records.filter(record => record.author?.publicId === filter.publicId) : records
  return <><div className="reader-feed"><PublicationView records={visible} error={error} heading={heading} ariaLabel="Общая страница" metadataHost={metadataHost}
    canRemove={record => record.isOwn} onRemove={remove} renderAuthor={author}
    emptyMessage={<><span>Публикации отсутствуют.</span><br /><span>Авторы ещё не готовы. Тексты зреют.</span></>} /></div>
    {statusHost && visible !== null ? createPortal(<span className="footer-status-text" role="status">Опубликовано {visible.length} {textCountNoun(visible.length)}</span>, statusHost) : null}
  </>
}
