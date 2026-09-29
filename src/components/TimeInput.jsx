import { useLayoutEffect, useRef } from 'react'
import { editTime } from './timeMask.js'

export default function TimeInput({ value, onChange, onInvalid, onKeyDown, ...props }) {
  const ref = useRef(null)
  const caret = useRef(null)
  useLayoutEffect(() => {
    if (caret.current !== null) {
      ref.current.setSelectionRange(caret.current, caret.current)
      caret.current = null
    }
  })
  const apply = (start, end, input, deletion) => {
    const result = editTime(value, start, end, input, deletion)
    if (!result) { onInvalid(); return }
    caret.current = result.cursor
    onChange(result.value)
    ref.current.setSelectionRange(result.cursor, result.cursor)
  }
  return <input {...props} ref={ref} type="text" inputMode="numeric" value={value}
    onKeyDown={(event) => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey && ['Backspace', 'Delete'].includes(event.key)) {
        event.preventDefault()
        apply(event.currentTarget.selectionStart, event.currentTarget.selectionEnd, '', event.key === 'Backspace' ? 'backward' : 'forward')
      } else onKeyDown?.(event)
    }}
    onPaste={(event) => {
      event.preventDefault()
      const pasted = event.clipboardData.getData('text').trim()
      if (!/^(?:\d{2}:\d{2}|\d{4})$/.test(pasted)) { onInvalid(); return }
      apply(event.currentTarget.selectionStart, event.currentTarget.selectionEnd, pasted)
    }}
    onChange={(event) => {
      // Native edits (including mobile keyboards) are reduced to a replacement.
      const raw = event.target.value
      let start = 0
      while (start < value.length && start < raw.length && value[start] === raw[start]) start++
      let suffix = 0
      while (suffix < value.length - start && suffix < raw.length - start && value.at(-1 - suffix) === raw.at(-1 - suffix)) suffix++
      apply(start, value.length - suffix, raw.slice(start, raw.length - suffix))
    }}
  />
}
