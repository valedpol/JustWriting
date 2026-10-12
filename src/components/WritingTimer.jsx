import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWritingToolPosition } from '../hooks/useWritingToolPosition.js'
import { timerMinutes, timerCountdown } from '../hooks/useWritingTimer.js'
import { wordCountNoun } from '../domain/wordCount.js'
import './DaySearch.css'
import './WritingTimer.css'

function TimerSetup({ position, onStart, onClose }) {
  const input = useRef(null)
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
    }
    document.addEventListener('keydown', escape, true)
    return () => document.removeEventListener('keydown', escape, true)
  }, [onClose])
  return <form id="writing-timer-setup" className="day-search writing-timer-setup" style={position} data-writing-tools
    aria-label="Настройка таймера" onClick={event => event.stopPropagation()} onSubmit={event => {
      event.preventDefault()
      if (timerMinutes(value) === null) { setInvalid(true); return }
      onStart(value)
    }}>
    <div className="archive-search-form"><input ref={input} type="text" inputMode="numeric" placeholder="количество минут"
      aria-label="Количество минут" aria-invalid={invalid} value={value} onChange={event => { setValue(event.target.value); setInvalid(false) }} /></div>
  </form>
}

export default function WritingTimer({ timer, setupOpen, anchor, metadataHost, onStart, onClose, layoutKey }) {
  const position = useWritingToolPosition(anchor, metadataHost, layoutKey)
  if (!position) return null
  const slot = { left: position.left, top: position.top, width: position.width }
  return createPortal(<>
    {setupOpen && !timer.running && timer.result === null ? <TimerSetup position={slot} onStart={onStart} onClose={onClose} /> : null}
    {timer.running ? <span className="writing-session-countdown" role="timer" aria-label="Таймер письма"
      style={{ left: position.iconCenter, top: position.top }} data-writing-tools>{timerCountdown(timer.remaining)}</span> : null}
    {timer.result !== null ? <div className="writing-timer-result" role="dialog" aria-labelledby="writing-timer-finished"
      style={slot} data-writing-tools onClick={event => event.stopPropagation()}>
      <p id="writing-timer-finished">Время закончилось.</p>
      <p>Набрано {timer.result} {wordCountNoun(timer.result)}</p>
      <button type="button" className="writing-timer-ok" onClick={timer.dismissResult}>ОК</button>
    </div> : null}
  </>, document.body)
}
