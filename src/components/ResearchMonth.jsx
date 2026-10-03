import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { researchMonth } from '../domain/researchMonth.js'

export default function ResearchMonth({ entries, month, label, selected, onSelect }) {
  const state = researchMonth(entries, month)
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
  return <button type="button" aria-pressed={selected}
    aria-label={label + (state.hasText ? ', есть текст' : ', нет текста')}
    aria-describedby={position ? tooltipId : undefined}
    className="research-month-button" onClick={onSelect}
    onPointerEnter={(event) => {
      if (!state.hasText || event.pointerType !== 'mouse') return
      const bounds = event.currentTarget.getBoundingClientRect()
      setPosition({ left: bounds.left + bounds.width / 2, top: bounds.top })
    }}
    onPointerLeave={hide} onPointerDown={hide}>
    {label}
    {state.hasText ? <span aria-hidden="true" className="research-month-mark" /> : null}
    {position ? createPortal(<span id={tooltipId} role="tooltip" className="research-day-tooltip"
      style={{ left: position.left, top: position.top }}>{state.tooltip}</span>, document.body) : null}
  </button>
}
