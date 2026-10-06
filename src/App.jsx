import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import './App.css'
import { useTodayText } from './hooks/useTodayText'
import { getWordCount } from './domain/wordCount'
import MyTexts from './MyTexts'
import Settings from './Settings'
import Research from './Research'
import ResearchNavigation from './components/ResearchNavigation'
import WordCounter from './components/WordCounter'
import WritingEditor from './components/WritingEditor.jsx'
import { useWorkspaceScroll } from './hooks/useWorkspaceScroll'
import { SCREEN_MODES, initialScreen, editorScreenReducer, restoreScreen, rememberSection } from './domain/editorScreen'
import { assertBackupWriterReady } from './backup/userBackup.js'

function formatLongDate(date) {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const text = formatter.format(date)
  return `${text.charAt(0).toUpperCase()}${text.slice(1).replace(/\s+г\.$/, '')}`
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

function App() {
  const { controller, text, status, error, userId, ready, flush, localProfile, updateSetting, dayEndsAt, graceUntil, endWriting, retry } = useTodayText()
  const authorName = localProfile?.displayName ?? 'Pol Valery'
  const [{ section, screenMode }, dispatchScreen] = useReducer(editorScreenReducer, initialScreen, () => restoreScreen())
  useEffect(() => { rememberSection(section) }, [section])
  const isToday = section === 'today'
  const [archiveWords, setArchiveWords] = useState(null)
  const [archiveMetadataHost, setArchiveMetadataHost] = useState(null)
  const [settingsStatusHost, setSettingsStatusHost] = useState(null)
  const [backupActive, setBackupActive] = useState(false)
  const [now, setNow] = useState(new Date())
  const editorRef = useRef(null)
  const workspaceRef = useRef(null)
  useWorkspaceScroll(workspaceRef, section)
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const currentDayWords = useMemo(() => getWordCount(text), [text])
  const countdown = useMemo(() => formatCountdown(dayEndsAt === null ? 0 : (graceUntil ?? dayEndsAt) - now.getTime()), [now, dayEndsAt, graceUntil])
  const setScreenMode = mode => {
    if (mode === SCREEN_MODES.interface) {
      editorRef.current?.finishComposition()
      editorRef.current?.cancelPanel()
      endWriting()
    }
    dispatchScreen({ type: 'mode', mode })
  }
  const openSection = nextSection => {
    if (backupActive) return
    editorRef.current?.finishComposition()
    editorRef.current?.cancelPanel()
    endWriting()
    if (nextSection === 'archive' && section !== 'archive') setArchiveWords(null)
    dispatchScreen({ type: 'section', section: nextSection })
  }
  const setWritingScreenMode = nextMode => {
    if (!isToday || !ready) return
    setScreenMode(nextMode)
    requestAnimationFrame(() => editorRef.current?.focus())
  }
  const handleTimerClick = event => {
    event.stopPropagation()
    if (!ready) return
    if (!isToday) openSection('today')
    setScreenMode(SCREEN_MODES.standard)
    requestAnimationFrame(() => editorRef.current?.focus(true))
  }
  const handleTimerKeyDown = event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleTimerClick(event) }
  }
  const handleAppClick = event => {
    if (!isToday || screenMode === SCREEN_MODES.interface || event.target.closest('.writing-editor, [data-writing-tools], .semantic-rail')) return
    setScreenMode(SCREEN_MODES.interface)
  }

  return (
    <div className={`app-shell screen-${screenMode}${section === 'archive' ? ' archive-page' : section === 'settings' ? ' settings-page' : section === 'research' ? ' research-page' : ''}`} onClick={isToday ? handleAppClick : undefined}>
      <header className="topbar">
        <div className="brand-block">Just Writing</div>

        <div className={`meta-block${graceUntil ? ' is-grace' : ''}`}>
          {screenMode === SCREEN_MODES.interface ? (
            <>
              <div className="meta-identity">
                <span className="meta-user">{authorName}</span>
                <span className="meta-divider">·</span>
                <span>{formatLongDate(now)}</span>
              </div>
              <div className="meta-countdown" role="button" tabIndex={0} onClick={handleTimerClick} onKeyDown={handleTimerKeyDown}>
                <span className="meta-countdown-label">осталось</span>
                <span className="meta-timer">{countdown}</span>
              </div>
            </>
          ) : (
            <>
              <span className="meta-user">{authorName}</span>
              <span className="meta-divider">·</span>
              <span className="meta-countdown-label" onClick={handleTimerClick}>осталось</span>
              <span className="meta-timer" role="button" tabIndex={0} onClick={handleTimerClick} onKeyDown={handleTimerKeyDown}>{countdown}</span>
            </>
          )}
        </div>

        <div className="topbar-actions">
          <div className="writing-tools">
            {screenMode !== SCREEN_MODES.interface ? (
              <button
                type="button"
                className="screen-mode-button search-button"
                aria-label="Поиск (скоро)"
                aria-disabled="true"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => event.stopPropagation()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="m15.5 15.5 5 5" />
                </svg>
              </button>
            ) : null}
            {screenMode !== SCREEN_MODES.interface ? (
              <button
                type="button"
                className="screen-mode-button"
                aria-label="Таймер (скоро)"
                aria-disabled="true"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => event.stopPropagation()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="14" r="7" />
                  <path d="M10 3h4M12 3v4M17 8l2-2M12 10v4l2 2" />
                </svg>
              </button>
            ) : null}
            {screenMode === SCREEN_MODES.standard ? (
              <button
                type="button"
                className="screen-mode-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation()
                  setWritingScreenMode(SCREEN_MODES.wide)
                }}
                aria-label="Перейти в широкий режим"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 3H3v6M3 3l7 7M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7M15 21h6v-6M21 21l-7-7" />
                </svg>
              </button>
            ) : null}
            {screenMode === SCREEN_MODES.wide ? (
              <button
                type="button"
                className="screen-mode-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation()
                  setWritingScreenMode(SCREEN_MODES.standard)
                }}
                aria-label="Перейти в стандартный режим"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 9h6V3M9 9 3 3M21 9h-6V3M15 9l6-6M3 15h6v6M9 15l-6 6M21 15h-6v6M15 15l6 6" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {graceUntil && isToday ? <div className="grace-alarm" role="status">
        <strong>ALARM!</strong> Начался новый день. Текст останется в предыдущем.
      </div> : null}

      <main className="main-layout" ref={workspaceRef}>
        <aside className="left-sidebar">
          <div className="quote-box">
            <p>
              Писать проще, когда вокруг тишина и достаточно времени, чтобы
              услышать себя.
            </p>
          </div>

          {section === 'research' ? <ResearchNavigation onExit={() => openSection('today')} /> : <nav className="side-menu" aria-label="Главное меню">
            <button type="button" className={`menu-item${section === 'archive' ? ' is-active' : ''}`} aria-current={section === 'archive' ? 'page' : undefined} onClick={() => openSection('archive')}>
              Мои тексты
            </button>
            <button type="button" className={`menu-item${section === 'today' ? ' is-active' : ''}`} aria-current={section === 'today' ? 'page' : undefined} onClick={() => openSection('today')}>
              Текст сегодня
            </button>
            <button type="button" className="menu-item">
              Общая страница
            </button>
            <button type="button" className="menu-item">
              Проект студии
            </button>
            <button type="button" className={`menu-item${section === 'research' ? ' is-active' : ''}`} aria-current={section === 'research' ? 'page' : undefined} onClick={() => openSection('research')}>
              Исследования
            </button>
            <button type="button" className={`menu-item${section === 'settings' ? ' is-active' : ''}`} aria-current={section === 'settings' ? 'page' : undefined} onClick={() => openSection('settings')}>
              Настройки
            </button>
          </nav>}
        </aside>

        <section className="editor-column">
          <div className="editor-shell today-editor-shell" hidden={!isToday}>
            <WritingEditor ref={editorRef} controller={controller} active={isToday} ready={ready}
              writing={screenMode !== SCREEN_MODES.interface} metadataHost={archiveMetadataHost}
              onActivate={() => setWritingScreenMode(SCREEN_MODES.standard)} />
          </div>
          {section === 'research' ? <Research userId={userId} flush={flush} /> : section === 'settings' ? <Settings profile={localProfile} onSave={updateSetting} statusHost={settingsStatusHost}
            onBackupActiveChange={setBackupActive} assertCanCreateBackup={() => assertBackupWriterReady(controller, status)} /> : section === 'archive' ? <MyTexts userId={userId} flush={flush} onTotalWords={setArchiveWords} metadataHost={archiveMetadataHost} onMetadataSaved={controller?.adoptArchiveMetadata} /> : null}
        </section>

        <aside className="right-sidebar" ref={setArchiveMetadataHost} />
      </main>

      <footer className="bottom-bar">
        <div className="footer-center">
          {isToday ? <>
            <WordCounter count={currentDayWords} goal={localProfile?.dailyWordGoal} />
          <span className="footer-status-text" role="status" title={error || 'Локальное хранение на этом устройстве'}>{status === 'loading' ? 'Загружаю' : status === 'saving' ? 'Сохраняю' : status === 'error' || status === 'load-error' ? 'Ошибка сохранения' : status === 'saved' ? 'Сохранено' : ''}</span>
          </> : section === 'archive' ? <>
            <span className="footer-status-text">Написано</span>
            <span>{archiveWords ?? '…'} слов</span>
          </> : <span ref={setSettingsStatusHost} />}
        </div>
      </footer>
      {error ? <p className="storage-error" role="alert">
        {error}
        {status === 'error' ? <> <button type="button" onClick={retry}>Повторить сохранение</button></> : null}
      </p> : null}
    </div>
  )
}

export default App
