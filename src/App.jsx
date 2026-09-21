import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const DRAFT_STORAGE_KEY = 'just-writing-draft'
const HISTORY_STORAGE_KEY = 'just-writing-history'
const SCREEN_MODES = {
  interface: 'interface',
  standard: 'writing-standard',
  wide: 'writing-wide',
}

function getWordCount(value) {
  if (!value || !value.trim()) {
    return 0
  }

  return value
    .replace(/\*\*|__|\*|_|<u>|<\/u>|[-#•*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length
}

function getDayKey(date) {
  const localDate = new Date(date)
  const year = localDate.getFullYear()
  const month = String(localDate.getMonth() + 1).padStart(2, '0')
  const day = String(localDate.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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

function loadDraft() {
  try {
    return window.localStorage.getItem(DRAFT_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function loadHistory() {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function App() {
  const [text, setText] = useState(() => loadDraft())
  const [screenMode, setScreenMode] = useState(SCREEN_MODES.interface)
  const [isSaving, setIsSaving] = useState(false)
  const [now, setNow] = useState(new Date())
  const [selectionToolbar, setSelectionToolbar] = useState({ visible: false, x: 0, y: 0 })
  const textareaRef = useRef(null)
  const toolbarRef = useRef(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      const nextHistory = loadHistory()
      nextHistory[getDayKey(new Date())] = text

      try {
        window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextHistory))
        window.localStorage.setItem(DRAFT_STORAGE_KEY, text)
      } catch {
        // Ignore local storage failures in the TEST version.
      }

      setIsSaving(false)
    }, 250)

    return () => window.clearTimeout(saveTimer)
  }, [text])

  const currentDayWords = useMemo(() => getWordCount(text), [text])

  const countdown = useMemo(() => {
    const nextMidnight = new Date(now)
    nextMidnight.setHours(24, 0, 0, 0)
    return formatCountdown(nextMidnight.getTime() - now.getTime())
  }, [now])

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
    const isWritingScreen = screenMode !== SCREEN_MODES.interface

    if (!hasSelection || !isWritingScreen) {
      setSelectionToolbar({ visible: false, x: 0, y: 0 })
      return
    }

    const position = getSelectionPosition(textarea, textarea.selectionStart)
    setSelectionToolbar({ visible: true, ...position })
  }

  const handleTextChange = (event) => {
    setIsSaving(true)
    setText(event.target.value)
    updateSelectionToolbar()
  }

  const handleTextareaClick = () => {
    if (screenMode === SCREEN_MODES.interface) {
      setScreenMode(SCREEN_MODES.standard)
    }
  }

  const handleTextareaKeyDown = (event) => {
    if (screenMode !== SCREEN_MODES.interface || event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    event.preventDefault()
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const nextText = `${text.slice(0, start)}${event.key}${text.slice(end)}`

    setText(nextText)
    setIsSaving(true)
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
    setScreenMode(nextMode)

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      updateSelectionToolbar()
    })
  }

  const handleAppClick = (event) => {
    if (screenMode === SCREEN_MODES.interface || textareaRef.current?.contains(event.target) || toolbarRef.current?.contains(event.target)) {
      return
    }

    setScreenMode(SCREEN_MODES.interface)
    setSelectionToolbar({ visible: false, x: 0, y: 0 })
  }

  const applyFormat = (prefix, suffix = prefix) => {
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
    const confirmed = window.confirm('Сбросить текущий текст? Это действие нельзя будет отменить.')

    if (!confirmed) {
      return
    }

    setText('')

    try {
      const nextHistory = loadHistory()
      nextHistory[getDayKey(new Date())] = ''
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextHistory))
      window.localStorage.setItem(DRAFT_STORAGE_KEY, '')
    } catch {
      // Ignore local storage failures in the TEST version.
    }
  }

  const toolbarVisible = selectionToolbar.visible && screenMode !== SCREEN_MODES.interface

  return (
    <div className={`app-shell screen-${screenMode}`} onClick={handleAppClick}>
      <header className="topbar">
        <div className="brand-block">Just Writing</div>

        <div className="meta-block">
          <span className="meta-user">Автор</span>
          <span className="meta-divider">•</span>
          <span>{formatLongDate(now)}</span>
          <span className="meta-divider">•</span>
          <span className="meta-timer">{countdown}</span>
        </div>

        <div className="topbar-actions">
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
      </header>

      <main className="main-layout">
        <aside className="left-sidebar" aria-hidden="true">
          <div className="quote-box">
            <p>
              Писать проще, когда вокруг тишина и достаточно времени, чтобы
              услышать себя.
            </p>
          </div>

          <nav className="side-menu" aria-label="Главное меню">
            <button type="button" className="menu-item is-active">
              Личный кабинет
            </button>
            <button type="button" className="menu-item">
              Работа с текстами
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
            <button type="button" className="menu-item">
              Настройки
            </button>
          </nav>
        </aside>

        <section className="editor-column">
          <div className="editor-shell">
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
              onSelect={updateSelectionToolbar}
              onClick={handleTextareaClick}
              onKeyDown={handleTextareaKeyDown}
              onBlur={handleTextareaBlur}
              readOnly={screenMode === SCREEN_MODES.interface}
              aria-label="Текстовый редактор"
              placeholder="Пиши просто. Просто пиши."
            />
          </div>
        </section>

        <aside className="right-sidebar" aria-hidden="true" />
      </main>

      <footer className="bottom-bar">
        <div className="footer-center">
          <span>{currentDayWords} слов</span>
          <span className="footer-status-text">{isSaving ? 'Сохраняю' : 'Сохранено'}</span>
        </div>
      </footer>
    </div>
  )
}

export default App
