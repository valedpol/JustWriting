import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import './App.css'
import { useTodayText } from './hooks/useTodayText'
import { getWordCount } from './domain/wordCount'
import MyTexts from './MyTexts'
import Settings from './Settings'
import WordCounter from './components/WordCounter'
import { useWorkspaceScroll } from './hooks/useWorkspaceScroll'
import { SCREEN_MODES, initialScreen, editorScreenReducer } from './domain/editorScreen'

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
  const { text, setText, status, error, userId, ready, flush, localProfile, updateSetting, dayEndsAt, graceUntil, endWriting, beginComposition, finishComposition } = useTodayText()
  const authorName = localProfile?.displayName ?? 'Pol Valery'
  const [{ section, screenMode }, dispatchScreen] = useReducer(editorScreenReducer, initialScreen)
  const isToday = section === 'today'
  const [archiveWords, setArchiveWords] = useState(null)
  const [archiveMetadataHost, setArchiveMetadataHost] = useState(null)
  const [settingsStatusHost, setSettingsStatusHost] = useState(null)
  const setScreenMode = (mode) => {
    if (mode === SCREEN_MODES.interface) endWriting()
    dispatchScreen({ type: 'mode', mode })
  }
  const openSection = (nextSection) => {
    endWriting()
    if (nextSection === 'archive' && section !== 'archive') setArchiveWords(null)
    dispatchScreen({ type: 'section', section: nextSection })
    setSelectionToolbar({ visible: false, x: 0, y: 0 })
  }
  const [now, setNow] = useState(new Date())
  const [selectionToolbar, setSelectionToolbar] = useState({ visible: false, x: 0, y: 0 })
  const workspaceRef = useRef(null)
  useWorkspaceScroll(workspaceRef, section)
  const textareaRef = useRef(null)
  const compositionCommit = useRef(null)
  const toolbarRef = useRef(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  const currentDayWords = useMemo(() => getWordCount(text), [text])

  const countdown = useMemo(() => {
    return formatCountdown(dayEndsAt === null ? 0 : (graceUntil ?? dayEndsAt) - now.getTime())
  }, [now, dayEndsAt, graceUntil])

  const getSelectionPosition = (textarea, selectionStart) => {
    const computedStyle = window.getComputedStyle(textarea)
    const mirror = document.createElement('div')
    const copiedProperties = [
      'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
      'textAlign', 'textTransform', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordBreak',
      'overflowWrap',
    ]

    copiedProperties.forEach((property) => {
      mirror.style[property] = computedStyle[property]
    })

    mirror.style.position = 'absolute'
    mirror.style.visibility = 'hidden'
    mirror.style.left = '-9999px'
    mirror.style.top = '0'
    mirror.style.whiteSpace = 'pre-wrap'
    mirror.style.wordWrap = 'break-word'
    mirror.textContent = textarea.value.slice(0, selectionStart)

    const marker = document.createElement('span')
    marker.textContent = '\u200b'
    mirror.append(marker)
    document.body.append(mirror)

    const markerRect = marker.getBoundingClientRect()
    const mirrorRect = mirror.getBoundingClientRect()
    const textareaRect = textarea.getBoundingClientRect()
    mirror.remove()

    return {
      x: textareaRect.left + markerRect.left - mirrorRect.left - textarea.scrollLeft,
      y: textareaRect.top + markerRect.top - mirrorRect.top - textarea.scrollTop,
    }
  }

  const updateSelectionToolbar = () => {
    const textarea = textareaRef.current

    if (!textarea) {
      return
    }

    const hasSelection = textarea.selectionStart !== textarea.selectionEnd
    const isWritingScreen = isToday && screenMode !== SCREEN_MODES.interface

    if (!hasSelection || !isWritingScreen) {
      setSelectionToolbar({ visible: false, x: 0, y: 0 })
      return
    }

    const position = getSelectionPosition(textarea, textarea.selectionStart)
    setSelectionToolbar({ visible: true, ...position })
  }

  const handleTextChange = (event) => {
    if (!isToday || !ready) return
    if (compositionCommit.current === event.target.value) { compositionCommit.current = null; return }
    compositionCommit.current = null
    setText(event.target.value)
    updateSelectionToolbar()
  }

  const handleTextareaClick = () => {
    if (!isToday || !ready) return
    if (screenMode === SCREEN_MODES.interface) {
      setScreenMode(SCREEN_MODES.standard)
    }
  }

  const handleTextareaKeyDown = (event) => {
    if (!isToday || !ready || screenMode !== SCREEN_MODES.interface || event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    event.preventDefault()
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const nextText = `${text.slice(0, start)}${event.key}${text.slice(end)}`

    setText(nextText)
    setScreenMode(SCREEN_MODES.standard)

    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + 1, start + 1)
    })
  }

  const handleTextareaBlur = (event) => {
    if (!toolbarRef.current?.contains(event.relatedTarget)) {
      setSelectionToolbar({ visible: false, x: 0, y: 0 })
    }
  }

  const setWritingScreenMode = (nextMode) => {
    if (!isToday || !ready) return
    setScreenMode(nextMode)

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      updateSelectionToolbar()
    })
  }

  const handleAppClick = (event) => {
    if (!isToday || screenMode === SCREEN_MODES.interface || textareaRef.current?.contains(event.target) || toolbarRef.current?.contains(event.target)) {
      return
    }

    setScreenMode(SCREEN_MODES.interface)
    setSelectionToolbar({ visible: false, x: 0, y: 0 })
  }

  const applyFormat = (prefix, suffix = prefix) => {
    if (!isToday || !ready) return
    const textarea = textareaRef.current

    if (!textarea) {
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = text.slice(start, end) || 'текст'
    const nextText = `${text.slice(0, start)}${prefix}${selectedText}${suffix}${text.slice(end)}`

    setText(nextText)

    window.requestAnimationFrame(() => {
      const nextSelectionStart = start + prefix.length
      const nextSelectionEnd = nextSelectionStart + selectedText.length

      textarea.focus()
      textarea.setSelectionRange(nextSelectionStart, nextSelectionEnd)
      updateSelectionToolbar()
    })
  }

  const handleResetText = () => {
    if (!isToday || !ready) return
    const confirmed = window.confirm('Сбросить текущий текст? Это действие нельзя будет отменить.')

    if (!confirmed) {
      return
    }

    setText('', screenMode !== SCREEN_MODES.interface)


  }

  const toolbarVisible = isToday && selectionToolbar.visible && screenMode !== SCREEN_MODES.interface

  return (
    <div className={`app-shell screen-${screenMode}${section === 'archive' ? ' archive-page' : section === 'settings' ? ' settings-page' : ''}`} onClick={isToday ? handleAppClick : undefined}>
      <header className="topbar">
        <div className="brand-block">Just Writing</div>

        <div className="meta-block">
          {screenMode === SCREEN_MODES.interface ? (
            <>
              <div className="meta-identity">
                <span className="meta-user">{authorName}</span>
                <span className="meta-divider">·</span>
                <span>{formatLongDate(now)}</span>
              </div>
              <div className="meta-countdown">
                <span className="meta-countdown-label">осталось</span>
                <span className="meta-timer">{countdown}</span>
              </div>
            </>
          ) : (
            <>
              <span className="meta-user">{authorName}</span>
              <span className="meta-divider">·</span>
              <span className="meta-countdown-label">осталось</span>
              <span className="meta-timer">{countdown}</span>
            </>
          )}
        </div>

        {graceUntil && isToday ? <div className="grace-alarm" role="status">
          <strong>ALARM!</strong> Начался новый день. Текст остаётся в предыдущем дне.
          <span> До закрытия {countdown}</span>
        </div> : null}

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

      <main className="main-layout" ref={workspaceRef}>
        <aside className="left-sidebar">
          <div className="quote-box">
            <p>
              Писать проще, когда вокруг тишина и достаточно времени, чтобы
              услышать себя.
            </p>
          </div>

          <nav className="side-menu" aria-label="Главное меню">
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
            <button type="button" className="menu-item">
              Исследования
            </button>
            <button type="button" className={`menu-item${section === 'settings' ? ' is-active' : ''}`} aria-current={section === 'settings' ? 'page' : undefined} onClick={() => openSection('settings')}>
              Настройки
            </button>
          </nav>
        </aside>

        <section className="editor-column">
          {section === 'settings' ? <Settings profile={localProfile} onSave={updateSetting} statusHost={settingsStatusHost} /> : section === 'archive' ? <MyTexts userId={userId} flush={flush} onTotalWords={setArchiveWords} metadataHost={archiveMetadataHost} /> : <div className="editor-shell">
            {toolbarVisible ? (
              <div
                ref={toolbarRef}
                className="selection-toolbar"
                style={{ left: selectionToolbar.x, top: selectionToolbar.y }}
                role="toolbar"
                aria-label="Форматирование текста"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => event.stopPropagation()}
              >
                <button type="button" onClick={() => applyFormat('**', '**')}>
                  Bold
                </button>
                <button type="button" onClick={() => applyFormat('*', '*')}>
                  Italic
                </button>
                <button type="button" onClick={() => applyFormat('__', '__')}>
                  Underline
                </button>
                <button type="button" onClick={() => applyFormat('- ')}>
                  List
                </button>
                <button type="button" onClick={() => applyFormat('1. ')}>
                  Numbered
                </button>
                <button type="button" className="danger" onClick={handleResetText}>
                  Сбросить текст
                </button>
              </div>
            ) : null}

            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              onCompositionStart={() => { compositionCommit.current = null; beginComposition() }}
              onCompositionEnd={(event) => { compositionCommit.current = event.currentTarget.value; finishComposition(event.currentTarget.value) }}
              onSelect={updateSelectionToolbar}
              onClick={handleTextareaClick}
              onKeyDown={handleTextareaKeyDown}
              onBlur={handleTextareaBlur}
              onScroll={() => setSelectionToolbar({ visible: false, x: 0, y: 0 })}
              readOnly={!ready || screenMode === SCREEN_MODES.interface}
              disabled={!ready}
              aria-label="Текстовый редактор"
              placeholder="Пиши просто. Просто пиши."
            />
          </div>}
        </section>

        <aside className="right-sidebar" ref={setArchiveMetadataHost} aria-hidden={isToday ? true : undefined} />
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
        {status === 'error' ? <> <button type="button" onClick={() => setText(text)}>Повторить сохранение</button></> : null}
      </p> : null}
    </div>
  )
}

export default App
