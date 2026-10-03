import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { researchDayCell } from '../domain/researchDayCell.js'

export default function ResearchDayCell({ entry, day, label, selected, disabled, onSelect }) {
  const state = researchDayCell(entry)
  const tooltipId = useId()
  const [position, setPosition] = useState(null)
  const visible = position !== null
  useEffect(() => {
    if (!visible) return
    const dismiss = () => setPosition(null)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [visible])
  const hide = () => setPosition(null)
  return <button type="button" disabled={disabled} aria-pressed={selected}
    aria-label={label + (state.hasText ? ', есть текст' : ', нет текста')}
    aria-describedby={position ? tooltipId : undefined}
    className="research-day-button" onClick={onSelect}
    onPointerEnter={(event) => {
      if (event.pointerType !== 'mouse') return
      const bounds = event.currentTarget.getBoundingClientRect()
      setPosition({ left: bounds.left + bounds.width / 2, top: bounds.top })
    }}
    onPointerLeave={hide} onPointerDown={hide}>
    <span className="research-day-number">{day}</span>
    <span aria-hidden="true" className={`research-day-cell${state.hasText ? ' has-text' : ''}`}>
      {state.reached ? <span className="research-day-dot" /> : null}
    </span>
    {position ? createPortal(<span id={tooltipId} role="tooltip" className="research-day-tooltip"
      style={{ left: position.left, top: position.top }}>{state.tooltip}</span>, document.body) : null}
  </button>
}
