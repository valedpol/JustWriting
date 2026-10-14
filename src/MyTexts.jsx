import OwnerPublications from './components/OwnerPublications.jsx'
import { listOwnPublications } from './storage/publicationRepository.js'
import { PUBLICATION_CHANNELS } from './publications/model.js'
import ArchiveWritingEntry from './components/ArchiveWritingEntry.jsx'
import ArchivePublicationSummary from './components/ArchivePublicationSummary.jsx'
import { listUserDays } from './storage/dayRepository.js'
import ReadonlySemanticMarkup from './components/ReadonlySemanticMarkup.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { listTexts } from './storage/textRepository'
import { getWordCount } from './domain/wordCount'
import { archiveDateTop, collapseAnchor } from './domain/archiveViewport.js'
import ArchiveCalendar from './components/ArchiveCalendar.jsx'
import { periodLabel } from './domain/calendarPeriod.js'
import { filterArchivePeriod, archiveCalendarEntries } from './domain/archivePeriod.js'
import { archiveSearch } from './domain/archiveSearch.js'
import MyTextsNavigation from './components/MyTextsNavigation.jsx'
import { archiveSemanticIndex, archiveSemanticSelection } from './domain/archiveSemanticIndex.js'
import { archiveDocument } from './editor/archiveDocument.js'
import { parseDocument } from './editor/document.js'
import './MyTexts.css'

function ArchiveRailHost({ textId, register, onActive }) {
  const ref = useCallback(node => register(textId, node), [textId, register])
  return <div className="archive-rail-host" ref={ref} onMouseDownCapture={onActive} onFocusCapture={onActive} />
}

function dateLabel(key) {
  return key.split('-').reverse().join('.')
}

export default function MyTexts({ userId, flush, onTotalWords, metadataHost, onMetadataSaved, navigationHost, onExit, onPublicationSummary, active = true, publicIdentity, onOpenProfile, navigationGroup, onOpenFeed }) {
  const returnScroll = useRef(null)
  const [publicationPage, setPublicationPage] = useState(null)
  const [publicationEntryEmpty, setPublicationEntryEmpty] = useState(false)
  const [publicationBusy, setPublicationBusy] = useState(false)
  const [publicationCounts, setPublicationCounts] = useState(null)
  const [publicationWords, setPublicationWords] = useState({})
  const updatePublicationWords = useCallback((channel, wordCount) => {
    setPublicationWords(previous => previous[channel] === wordCount ? previous : { ...previous, [channel]: wordCount })
  }, [])
  useEffect(() => {
    onPublicationSummary?.(publicationPage ? {
      channel: publicationPage,
      wordCount: publicationWords[publicationPage] ?? null,
    } : null)
  }, [publicationPage, publicationWords, onPublicationSummary])
  const updatePublicationCount = useCallback((channel, count) => {
    setPublicationCounts(previous => previous?.[channel] === count ? previous : { ...previous, [channel]: count })
  }, [])
  const [records, setRecords] = useState(null)
  const [userDays, setUserDays] = useState([])
  const [expanded, setExpanded] = useState(() => new Set())
  const [failed, setFailed] = useState(false)
  const [period, setPeriod] = useState(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [changingPeriod, setChangingPeriod] = useState(false)
  const [periodError, setPeriodError] = useState('')
  const periodChange = useRef(false)
  const resetResults = useRef(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [semanticPage, setSemanticPage] = useState(null)
  const [semanticSelected, setSemanticSelected] = useState(null)
  const [titleContext, setTitleContext] = useState(null)
  const [titleReload, setTitleReload] = useState(0)
  const semanticReturn = useRef(null)
  const semanticIndex = useMemo(() => archiveSemanticIndex(records ?? []), [records])
  const semanticSelection = useMemo(() => semanticPage ? archiveSemanticSelection(records ?? [], semanticIndex, semanticPage, semanticSelected) : null,
    [records, semanticIndex, semanticPage, semanticSelected])
  const titleItem = semanticPage === 'title' ? semanticSelection?.occurrences[0] : null
  const titleView = semanticPage === 'title'
  const titleWholeDay = titleItem && titleContext === titleItem.id
  const [calendarYearHost, setCalendarYearHost] = useState(null)
  const [draftQuery, setDraftQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [activeSearchId, setActiveSearchId] = useState(null)
  const [locateRequest, setLocateRequest] = useState(null)
  const searchResults = useMemo(() => records && activeQuery ? archiveSearch(filterArchivePeriod(records, period), activeQuery) : null, [records, period, activeQuery])
  const visibleRecords = useMemo(() => semanticSelection ? filterArchivePeriod(semanticSelection.records, period)
    : searchResults?.records ?? (records ? filterArchivePeriod(records, period) : null), [semanticSelection, searchResults, records, period])
  const effectiveActiveSearchId = searchResults?.occurrences.some(item => item.id === activeSearchId) ? activeSearchId : searchResults?.occurrences[0]?.id ?? null
  const activeIndex = searchResults?.occurrences.findIndex(item => item.id === effectiveActiveSearchId) ?? -1
  const [metadataLayout, setMetadataLayout] = useState(null)
  const [railHosts, setRailHosts] = useState({})
  const registerHost = useCallback((id, node) => setRailHosts(previous => previous[id] === node ? previous : { ...previous, [id]: node }), [])
  const handleSaved = useCallback(async (saved, previous) => {
    setRecords(items => items.map(item => item.textId === saved.textId ? saved : item))
    await onMetadataSaved?.(saved, previous)
  }, [onMetadataSaved])
  const pendingWrites = useRef(flush)
  const scrollArea = useRef(null)
  const actionsSlot = useRef(null)
  const [scrollElement, setScrollElement] = useState(null)
  const setScrollArea = useCallback(node => { scrollArea.current = node; setScrollElement(node) }, [])
  const positioned = useRef(false)
  const pendingExpansion = useRef(null)
  const pendingCollapse = useRef(null)
  const activeRecord = useRef(null)
  const editors = useRef(new Map())
  const [hasOpened, setHasOpened] = useState(false)

  useLayoutEffect(() => {
    if (active && !semanticPage && !publicationPage && returnScroll.current !== null && scrollArea.current) {
      scrollArea.current.scrollTop = returnScroll.current
      returnScroll.current = null
    }
  }, [active, semanticPage, publicationPage])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    pendingWrites.current().then(() => Promise.all([listTexts(userId), listUserDays(userId)])).then(([items, days]) => {
      if (!cancelled) {
        const ordered = [...items].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
        setUserDays(days)
        setRecords(ordered)
        onTotalWords(ordered.reduce((total, record) => total + getWordCount(record.content), 0))
      }
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [userId, onTotalWords])

  useLayoutEffect(() => {
    const area = scrollArea.current
    if (!active || publicationPage || !area) return
    const measure = () => area.style.setProperty('--archive-height', `${area.clientHeight}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => observer.disconnect()
  }, [active, semanticPage, publicationPage])

  useLayoutEffect(() => {
    const area = scrollArea.current
    if (!area || publicationPage) return
    if (resetResults.current) {
      resetResults.current = false
      const list = area.querySelector('ul')
      if (list) list.style.paddingTop = ''
      area.scrollTop = 0
      positioned.current = true
      return
    }
    if (!visibleRecords?.length) return
    const anchor = pendingCollapse.current
    pendingCollapse.current = null
    if (anchor) {
      const item = Array.from(area.querySelectorAll('[data-text-id]')).find(node => node.dataset.textId === anchor.textId)
      if (item) {
        const list = area.querySelector('ul')
        const desiredScroll = area.scrollTop + item.getBoundingClientRect().top - area.getBoundingClientRect().top - anchor.top
        // Near the beginning the collapsed rows may be too short to keep the
        // anchor in place: provide space rather than requesting negative scroll.
        if (desiredScroll < 0 && list) {
          const padding = parseFloat(getComputedStyle(list).paddingTop) || 0
          list.style.paddingTop = `${padding - desiredScroll}px`
        }
        area.scrollTop += item.getBoundingClientRect().top - area.getBoundingClientRect().top - anchor.top
      }
      return
    }
    const openedId = pendingExpansion.current
    pendingExpansion.current = null
    if (openedId) {
      const list = area.querySelector('ul')
      if (list) list.style.paddingTop = ''
      if (openedId === visibleRecords[0].textId) {
        area.scrollTop = 0
      } else {
        const item = Array.from(area.querySelectorAll('[data-text-id]')).find((node) => node.dataset.textId === openedId)
        const content = item?.querySelector('.saved-text')
        if (content) {
          const lineHeight = parseFloat(getComputedStyle(content).lineHeight) || 31
          const contextHeight = Math.min(lineHeight * 3, area.clientHeight / 3)
          area.scrollTop += content.getBoundingClientRect().top - area.getBoundingClientRect().top - contextHeight
        }
      }
      return
    }
    if (positioned.current) return
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const target = visibleRecords.find((record) => record.dayKey === today) || visibleRecords[visibleRecords.length - 1]
    const item = Array.from(area.querySelectorAll('[data-text-id]')).find((node) => node.dataset.textId === target.textId)
    if (item) {
      area.scrollTop += item.getBoundingClientRect().top - area.getBoundingClientRect().top - area.clientHeight / 3
      positioned.current = true
    }
  }, [records, expanded, period, activeQuery, semanticPage, publicationPage, visibleRecords])

  useLayoutEffect(() => {
    const area = scrollArea.current
    if (!active || publicationPage || !area || !metadataHost || !records) return
    const alignMetadata = () => {
      const viewport = area.getBoundingClientRect()
      const host = metadataHost.getBoundingClientRect()
      setMetadataLayout({
        top: viewport.top - host.top, height: viewport.height,
        actionsTop: actionsSlot.current.getBoundingClientRect().top - host.top,
        positions: Array.from(area.querySelectorAll('[data-text-id]')).map((item) => {
          const bounds = item.getBoundingClientRect()
          const date = Array.from(metadataHost.querySelectorAll('[data-archive-date]'))
            .find(node => node.dataset.archiveDate === item.dataset.textId)
          return { textId: item.dataset.textId, top: bounds.top - viewport.top,
            bottom: bounds.bottom - viewport.top, dateHeight: date?.parentElement.getBoundingClientRect().height || 40 }
        }),
      })
    }
    alignMetadata()
    area.addEventListener('scroll', alignMetadata, { passive: true })
    window.addEventListener('resize', alignMetadata)
    const observer = new ResizeObserver(alignMetadata)
    observer.observe(area)
    observer.observe(metadataHost)
    if (area.firstElementChild) observer.observe(area.firstElementChild)
    return () => {
      area.removeEventListener('scroll', alignMetadata)
      window.removeEventListener('resize', alignMetadata)
      observer.disconnect()
    }
  }, [active, records, expanded, metadataHost, period, calendarOpen, activeQuery, semanticPage, publicationPage, visibleRecords])

  const changeCriteria = async (nextPeriod, nextQuery) => {
    if (periodChange.current) return
    periodChange.current = true
    setChangingPeriod(true)
    setPeriodError('')
    try {
      // Drain every open editor first, then read current records: markup saves
      // may have changed which records match while the queue was pending.
      await Promise.all([...editors.current.values()].map(editor => editor.flush()))
      const fresh = [...await listTexts(userId)].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
      const candidates = filterArchivePeriod(semanticPage
        ? archiveSemanticSelection(fresh, archiveSemanticIndex(fresh), semanticPage, semanticSelection.selected).records : fresh, nextPeriod)
      const result = nextQuery ? archiveSearch(candidates, nextQuery) : null
      const retained = new Set((result?.records ?? candidates).map(record => record.textId))
      const disappearing = visibleRecords.filter(record => !retained.has(record.textId))
      const selection = window.getSelection()
      if (selection?.rangeCount && disappearing.some(record => {
        const node = Array.from(scrollArea.current.querySelectorAll('[data-text-id]')).find(item => item.dataset.textId === record.textId)
        return node && selection.getRangeAt(0).intersectsNode(node)
      })) selection.removeAllRanges()
      setExpanded(previous => result ? retained : new Set([...previous].filter(id => retained.has(id))))
      pendingExpansion.current = null
      pendingCollapse.current = null
      if (!retained.has(activeRecord.current)) activeRecord.current = null
      resetResults.current = true
      setHasOpened(true)
      setRecords(fresh)
      setPeriod(nextPeriod)
      setActiveQuery(nextQuery)
      const first = result?.occurrences[0]?.id ?? null
      setActiveSearchId(first)
      setLocateRequest(first ? { id: first } : null)
    } catch (error) { setPeriodError(error.message || 'Не удалось завершить сохранение. Критерии не изменены.') }
    finally { periodChange.current = false; setChangingPeriod(false) }
  }
  const changePeriod = nextPeriod => {
    if (nextPeriod !== period) return changeCriteria(nextPeriod, activeQuery)
  }
  const locateOccurrence = index => {
    const item = searchResults?.occurrences[index]
    if (!item) return
    pendingExpansion.current = null
    pendingCollapse.current = null
    setExpanded(previous => new Set([...previous, item.textId]))
    setActiveSearchId(item.id)
    setLocateRequest({ id: item.id })
  }

  useLayoutEffect(() => {
    if (!locateRequest || publicationPage || !active) return
    const occurrence = searchResults?.occurrences.find(item => item.id === locateRequest.id)
    if (!occurrence && !locateRequest.markupId && locateRequest.position === undefined) return
    const find = () => [...document.querySelectorAll('[data-search-occurrence]')].find(node => node.dataset.searchOccurrence === occurrence.id)
    const reveal = () => {
      const bounds = locateRequest.position !== undefined
        ? editors.current.get(locateRequest.textId)?.locatePosition(locateRequest.position)
        : locateRequest.markupId
        ? editors.current.get(locateRequest.textId)?.locateSemantic(locateRequest.markupId)
        : find()?.getBoundingClientRect()
      if (!bounds || !scrollArea.current) return false
      const area = scrollArea.current
      const viewport = area.getBoundingClientRect()
      area.scrollTop += bounds.top - viewport.top - (locateRequest.top ?? area.clientHeight / 3)
      setLocateRequest(null)
      return true
    }
    if (reveal()) return
    // Semantic rails mount through portals after the EditorView is ready.
    const observer = new MutationObserver(() => { if (reveal()) observer.disconnect() })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [locateRequest, records, expanded, activeQuery, period, searchResults?.occurrences, semanticPage, publicationPage, active, titleContext, titleReload])

  const toggleRecord = async (record) => {
    const opening = !expanded.has(record.textId)
    if (opening && semanticPage) {
      if (periodChange.current) return
      periodChange.current = true
      setChangingPeriod(true); setPeriodError('')
      try {
        await Promise.all([...editors.current.values()].map(editor => editor.flush()))
        await pendingWrites.current()
        const fresh = [...await listTexts(userId)].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
        const selection = archiveSemanticSelection(fresh, archiveSemanticIndex(fresh), semanticPage, semanticSelection.selected)
        const matches = selection.occurrences.filter(item => item.textId === record.textId)
        const item = matches.find(item => item.id === semanticSelection.selected) ?? matches[0]
        setRecords(fresh)
        if (!item) throw new Error('Разметка больше недоступна. Выберите текст из обновлённого списка.')
        setExpanded(previous => new Set([...previous, record.textId]))
        setHasOpened(true)
        pendingExpansion.current = null
        pendingCollapse.current = null
        activeRecord.current = record.textId
        setLocateRequest({ textId: record.textId, markupId: item.markupId })
      } catch (error) { setPeriodError(error.message || 'Не удалось открыть текст.') }
      finally { periodChange.current = false; setChangingPeriod(false) }
      return
    }
    pendingExpansion.current = opening ? record.textId : null
    if (opening) setHasOpened(true)
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(record.textId)) next.delete(record.textId)
      else next.add(record.textId)
      return next
    })
  }

  const collapseAll = () => {
    const area = scrollArea.current
    if (!area || !expanded.size) return
    const viewport = area.getBoundingClientRect()
    const entries = Array.from(area.querySelectorAll('[data-text-id]'))
      .filter(node => expanded.has(node.dataset.textId)).map(node => {
        const bounds = node.getBoundingClientRect()
        return { textId: node.dataset.textId, top: bounds.top - viewport.top, bottom: bounds.bottom - viewport.top }
      })
    pendingCollapse.current = collapseAnchor(entries, activeRecord.current, area.clientHeight)
    pendingExpansion.current = null
    setExpanded(new Set())
  }

  const selectDay = record => {
    activeRecord.current = record.textId
    editors.current.get(record.textId)?.toggleSelection()
  }

  const openPublications = async () => {
    setChangingPeriod(true); setPeriodError('')
    try {
      await Promise.all([...editors.current.values()].map(editor => editor.flush()))
      await pendingWrites.current()
      const counts = Object.fromEntries(await Promise.all(PUBLICATION_CHANNELS.map(async channel =>
        [channel, (await listOwnPublications(userId, channel)).length])))
      setPublicationCounts(counts)
      setPublicationWords({})
      setPublicationEntryEmpty(PUBLICATION_CHANNELS.every(channel => counts[channel] === 0))
      window.getSelection()?.removeAllRanges()
      // Entry choice only. Later count changes never navigate away from a channel.
      setPublicationPage(PUBLICATION_CHANNELS.find(channel => counts[channel] > 0) ?? 'profile')
    } catch { setPeriodError('Не удалось завершить сохранение или загрузить публикации. Повторите вход.') }
    finally { setChangingPeriod(false) }
  }
  useEffect(() => {
    if (navigationGroup === 'publications') openPublications()
    else if (navigationGroup === 'archive') setPublicationPage(null)
    // Entry choice only; count changes must not switch channels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationGroup, userId])
  const openOwnProfile = async () => {
    if (!onOpenProfile || publicIdentity?.profileVisible !== true) return
    setChangingPeriod(true); setPeriodError('')
    try {
      await Promise.all([...editors.current.values()].map(editor => editor.flush()))
      await pendingWrites.current()
      returnScroll.current = scrollArea.current?.scrollTop ?? null
      onOpenProfile({ publicId: publicIdentity.publicId, displayName: publicIdentity.displayName })
    } catch { setPeriodError('Не удалось завершить сохранение. Повторите вход в профиль.') }
    finally { setChangingPeriod(false) }
  }
  const openSemantic = async page => {
    if (periodChange.current) return
    periodChange.current = true
    setChangingPeriod(true); setPeriodError('')
    try {
      await Promise.all([...editors.current.values()].map(editor => editor.flush()))
      await pendingWrites.current()
      const fresh = [...await listTexts(userId)].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
      semanticReturn.current = { expanded: new Set(expanded), hasOpened, scrollTop: scrollArea.current?.scrollTop ?? 0, period, activeQuery, activeSearchId }
      window.getSelection()?.removeAllRanges()
      setRecords(fresh)
      const selected = archiveSemanticSelection(fresh, archiveSemanticIndex(fresh), page, null)
      setSemanticSelected(selected.selected)
      setSemanticPage(page)
      setTitleContext(null)
      setExpanded(new Set(page === 'title' ? selected.records.map(record => record.textId) : []))
      setHasOpened(true)
      setPeriod(null)
      setActiveQuery('')
      setLocateRequest(null)
      pendingExpansion.current = null
      pendingCollapse.current = null
      resetResults.current = true
    } catch { setPeriodError('Не удалось завершить сохранение или загрузить разметку. Повторите вход.') }
    finally { periodChange.current = false; setChangingPeriod(false) }
  }
  const selectSemantic = async selected => {
    if (periodChange.current || selected === semanticSelection.selected) return
    periodChange.current = true
    setChangingPeriod(true); setPeriodError('')
    try {
      await Promise.all([...editors.current.values()].map(editor => editor.flush()))
      await pendingWrites.current()
      const fresh = [...await listTexts(userId)].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
      const index = archiveSemanticIndex(fresh)
      if (!(semanticPage === 'title' ? index.titles.some(item => item.id === selected) : index.tags.some(item => item.value === selected))) {
        setRecords(fresh)
        throw new Error('Разметка больше недоступна. Выберите пункт из обновлённого списка.')
      }
      window.getSelection()?.removeAllRanges()
      setRecords(fresh)
      setSemanticSelected(selected)
      setTitleContext(null)
      setExpanded(new Set(semanticPage === 'title' ? archiveSemanticSelection(fresh, index, semanticPage, selected).records.map(record => record.textId) : []))
      setPeriod(null)
      setActiveQuery('')
      setLocateRequest(null)
      pendingExpansion.current = null
      pendingCollapse.current = null
      resetResults.current = true
    } catch (error) { setPeriodError(error.message || 'Не удалось завершить сохранение.') }
    finally { periodChange.current = false; setChangingPeriod(false) }
  }
  const toggleTitleContext = async () => {
    if (periodChange.current || !titleItem) return
    periodChange.current = true
    setChangingPeriod(true); setPeriodError('')
    const anchor = editors.current.get(titleItem.textId)?.viewportAnchor(titleItem.range)
    const headerHeight = scrollArea.current?.querySelector('.archive-title-header')?.getBoundingClientRect().height ?? 0
    try {
      await Promise.all([...editors.current.values()].map(editor => editor.flush()))
      await pendingWrites.current()
      const fresh = [...await listTexts(userId)].sort((a, b) => a.dayKey.localeCompare(b.dayKey))
      const item = archiveSemanticIndex(fresh).titles.find(item => item.id === titleItem.id)
      setRecords(fresh)
      if (!item) throw new Error('Разметка больше недоступна. Выберите пункт из обновлённого списка.')
      const changed = fresh.find(record => record.textId === item.textId)?.revision !== records.find(record => record.textId === item.textId)?.revision
      if (changed) setTitleReload(value => value + 1)
      window.getSelection()?.removeAllRanges()
      setTitleContext(titleWholeDay ? null : item.id)
      setLocateRequest(titleWholeDay && !item.range ? null : { textId: item.textId, position: changed ? item.position : anchor?.position ?? item.position, top: changed ? headerHeight : anchor?.top ?? headerHeight })
    } catch (error) { setPeriodError(error.message || 'Не удалось показать контекст.') }
    finally { periodChange.current = false; setChangingPeriod(false) }
  }
  const closeSemantic = async () => {
    if (periodChange.current) return
    periodChange.current = true
    setChangingPeriod(true); setPeriodError('')
    try {
      await Promise.all([...editors.current.values()].map(editor => editor.flush()))
      window.getSelection()?.removeAllRanges()
      const previous = semanticReturn.current
      setExpanded(previous?.expanded ?? new Set())
      setHasOpened(previous?.hasOpened ?? false)
      setPeriod(previous?.period ?? null)
      setActiveQuery(previous?.activeQuery ?? '')
      setActiveSearchId(previous?.activeSearchId ?? null)
      returnScroll.current = previous?.scrollTop ?? 0
      setSemanticPage(null)
      setLocateRequest(null)
      pendingExpansion.current = null
      pendingCollapse.current = null
      resetResults.current = false
      semanticReturn.current = null
    } catch { setPeriodError('Не удалось завершить сохранение. Повторите возврат.') }
    finally { periodChange.current = false; setChangingPeriod(false) }
  }
  const navigation = <MyTextsNavigation navigationGroup={navigationGroup} onOpenFeed={onOpenFeed} onExit={onExit} searchOpen={searchOpen} onSearchOpen={setSearchOpen}
    semanticPage={semanticPage} semanticIndex={semanticIndex} semanticSelected={semanticSelection?.selected}
    onSemanticSelect={selectSemantic} onSemanticOpen={openSemantic} onSemanticBack={closeSemantic}
    publicIdentity={publicIdentity} onOpenProfile={onOpenProfile ? openOwnProfile : undefined}
    draft={draftQuery} onDraft={setDraftQuery} onSubmit={() => changeCriteria(period, draftQuery.trim())}
    results={searchResults} activeIndex={activeIndex} onLocate={locateOccurrence} busy={changingPeriod || publicationBusy || !records} publicationPage={publicationPage} publicationCounts={publicationCounts}
    onPublicationsOpen={openPublications} onPublicationChannel={channel => {
      setPublicationEntryEmpty(false)
      if (channel !== publicationPage) updatePublicationWords(channel, null)
      setPublicationPage(channel)
    }}
    onPublicationsBack={navigationGroup === 'publications' ? onExit : () => setPublicationPage(null)} />
  return <>{active ? navigationHost ? createPortal(navigation, navigationHost) : navigation : null}<div className="editor-shell my-texts" hidden={!active || !!publicationPage || navigationGroup === 'publications'}>
    {records ? <div className="archive-calendar-controls">
      <div className="archive-calendar-heading">
      <button type="button" aria-expanded={calendarOpen} aria-controls="archive-calendar" onMouseDown={event => event.preventDefault()} onClick={() => setCalendarOpen(open => !open)}>Календарь</button>
      {calendarOpen ? <fieldset ref={setCalendarYearHost} className="research-time archive-calendar-years" disabled={changingPeriod} /> : null}
      {period ? <span className="archive-period">{periodLabel(period)} <button type="button" aria-label="Снять выбранный период" disabled={changingPeriod} onClick={() => changePeriod(null)}>×</button></span> : null}
      {activeQuery ? <span className="archive-period archive-search-criterion"><span title={activeQuery}>Поиск: {activeQuery}</span> <button type="button" aria-label="Снять поиск" disabled={changingPeriod} onClick={() => changeCriteria(period, '')}>×</button></span> : null}
      </div>
      {periodError ? <p role="alert">{periodError}</p> : null}
      {calendarOpen ? <fieldset id="archive-calendar" disabled={changingPeriod}>
        <ArchiveCalendar entries={archiveCalendarEntries(records, userDays)} yearHost={calendarYearHost}
          period={period ?? records.at(-1)?.dayKey ?? new Date().toISOString().slice(0, 10)}
          currentKey={[...records.map(record => record.dayKey), new Date().toISOString().slice(0, 10)].sort().at(-1)}
          onSelect={changePeriod} />
      </fieldset> : null}
    </div> : null}
    <div className="archive-actions-space" ref={actionsSlot} aria-hidden="true" />
    <div className={`archive-scroll${hasOpened ? ' is-reading' : ''}`} ref={setScrollArea}>
      {failed ? <p role="alert">Не удалось прочитать сохранённые тексты.</p>
        : !records ? <p role="status">Загружаю…</p>
        : visibleRecords.length ? <ul>
          {visibleRecords.map((record) => <li key={record.textId} data-text-id={record.textId}
            onMouseDownCapture={() => { activeRecord.current = record.textId }}
            onFocusCapture={() => { activeRecord.current = record.textId }}>
            {!titleView && !expanded.has(record.textId) ? <button className="archive-preview-button" type="button" aria-label={`Раскрыть текст за ${dateLabel(record.dayKey)}`} aria-expanded={false} onClick={() => toggleRecord(record)}>
              <span className="text-preview">{record.content.trim().replace(/\s+/g, ' ').slice(0, 240) || 'Текст пуст.'}</span>
            </button> : null}
            {titleView || expanded.has(record.textId) ? <>
              {titleView ? <div className="archive-title-header">
                <strong>{titleItem?.value}</strong>
                <button type="button" disabled={changingPeriod} onClick={toggleTitleContext}>{titleWholeDay ? 'Только текст' : 'Весь день'}</button>
              </div> : <div className="archive-record-header" onClick={() => toggleRecord(record)}>
              <button className="archive-record-info" type="button" aria-expanded aria-label={`Свернуть текст за ${dateLabel(record.dayKey)}`}>
                {dateLabel(record.dayKey)}
              </button>
              </div>}
              {titleView && !titleWholeDay && !titleItem?.range ? <p className="archive-title-unresolved">Границы текста ещё не заданы.</p> :
              <div className="saved-text" aria-label="Сохранённый текст, только для чтения">
                <ArchiveWritingEntry ref={editor => { if (editor) editors.current.set(record.textId, editor); else editors.current.delete(record.textId) }}
                  key={titleView ? `${titleItem?.id}:${titleReload}` : record.textId}
                  visibleRange={titleView && !titleWholeDay ? titleItem?.range : null} contextRange={titleWholeDay ? titleItem?.range : null}
                  searchOccurrences={searchResults?.occurrences.filter(item => item.textId === record.textId)} activeSearchId={effectiveActiveSearchId}
                  record={record} active={active && !publicationPage} layoutRevision={calendarOpen} metadataHost={railHosts[record.textId]} scrollElement={scrollElement} onSaved={handleSaved} />
              </div>}
            </> : null}
          </li>)}
        </ul> : <p>{period ? 'В выбранном периоде текстов нет.' : semanticPage ? semanticPage === 'title' ? 'Названий пока нет.' : 'Тегов пока нет.' : activeQuery ? 'Совпадений нет.' : 'Сохранённых текстов пока нет.'}</p>}
    </div>
  </div>
    {active && !publicationPage && metadataHost && metadataLayout && records ? createPortal(
      <>
      {!titleView && expanded.size > 0 ? <div className="archive-actions" style={{ top: metadataLayout.actionsTop }}>
        <button type="button" onClick={collapseAll}>Схлопнуть все тексты</button>
      </div> : null}
      <div className="archive-day-metadata" style={{ top: metadataLayout.top, height: metadataLayout.height }}>
        {visibleRecords.map((record, index) => {
          const position = metadataLayout.positions[index]
          const open = titleView || expanded.has(record.textId)
          const top = position?.top ?? 0
          const bottom = position?.bottom ?? top
          return open ? <div key={record.textId}>
            <ArchiveRailHost textId={record.textId} register={registerHost} onActive={() => { activeRecord.current = record.textId }} />
            <div className="archive-day-label archive-sticky-date"
              style={{ top: archiveDateTop(top, bottom, position?.dateHeight ?? 40) }}>
              <button type="button" data-archive-date={record.textId}
                disabled={titleView && !titleWholeDay && !titleItem?.range}
                aria-label={titleView && !titleWholeDay ? `Выделить текст «${titleItem?.value}»` : `Выделить весь текст за ${dateLabel(record.dayKey)}`}
                onMouseDown={event => event.preventDefault()} onClick={() => selectDay(record)}>
                <span>{dateLabel(record.dayKey)}</span>
                {titleView && !titleWholeDay && !titleItem?.range ? null : <span>{getWordCount(titleView && !titleWholeDay ? parseDocument(archiveDocument(record)).textBetween(titleItem.range.from, titleItem.range.to, '\n', '\n') : record.content).toLocaleString('ru-RU')} слов</span>}
              </button>
            </div>
          </div> : <div
          key={record.textId}
          className="archive-day-label"
          style={{ top, minHeight: Math.max(0, bottom - top) }}
          onClick={() => toggleRecord(record)}
        ><button
          type="button"
          aria-expanded={expanded.has(record.textId)}
          aria-label={`${expanded.has(record.textId) ? 'Свернуть' : 'Раскрыть'} текст за ${dateLabel(record.dayKey)}`}
        >
          <span>{dateLabel(record.dayKey)}</span>
          <span>{getWordCount(record.content).toLocaleString('ru-RU')} слов</span>
        </button>
          <ReadonlySemanticMarkup record={record} />
          <ArchivePublicationSummary record={record} />
        </div>
        })}
      </div></>, metadataHost,
    ) : null}
    {publicationPage && active ? <OwnerPublications key={`${userId}:${publicationPage}`} userId={userId} channel={publicationPage} onBusyChange={setPublicationBusy} onCountChange={updatePublicationCount} onWordCountChange={updatePublicationWords} metadataHost={metadataHost}
      emptyMessage={publicationEntryEmpty ? 'Публикаций нет.' : undefined} /> : null}
  </>
}
