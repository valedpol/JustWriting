import { useId, useMemo, useState } from 'react'

function describeZone(timeZone, now) {
  const city = timeZone.split('/').slice(1).join(' / ').replaceAll('_', ' ') || timeZone
  const parts = (style) => new Intl.DateTimeFormat('ru', { timeZone, timeZoneName: style }).formatToParts(now).find((part) => part.type === 'timeZoneName').value
  const offset = parts('longOffset').replace('GMT', 'UTC')
  return { value: timeZone, label: `${city} — ${parts('longGeneric')} (${offset})` }
}

export default function TimezoneSelect({ id, value, onChange }) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [offsetDate, setOffsetDate] = useState(() => new Date())
  const options = useMemo(() => {
    const now = offsetDate
    return [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC', value])]
      .map((zone) => describeZone(zone, now))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'))
  }, [value, offsetDate])
  const selected = options.find((option) => option.value === value)
  const filtered = options.filter((option) => `${option.label} ${option.value}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const choose = (option) => {
    if (!option) return
    onChange(option.value)
    setOpen(false)
    setQuery('')
  }
  return <div className="settings-timezone" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery('') }
  }}>
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open}
      aria-controls={listId} aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
      value={open ? query : selected?.label ?? value} placeholder={selected?.label}
      autoComplete="off"
      onFocus={() => { setOffsetDate(new Date()); setOpen(true); setActive(0) }}
      onClick={() => setOpen(true)}
      onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true) }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setOpen(false); setQuery('') }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          setOpen(true)
          setActive((index) => Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
        }
        if (event.key === 'Enter' && open) { event.preventDefault(); choose(filtered[active]) }
      }}
    />
    {open ? <div className="settings-timezone-options" id={listId} role="listbox" aria-label="Часовые пояса">
      {filtered.map((option, index) => <div key={option.value} id={`${listId}-${index}`} role="option"
        aria-selected={value === option.value} className={index === active ? 'is-highlighted' : ''}
        ref={(node) => { if (node && index === active) node.scrollIntoView({ block: 'nearest' }) }}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
        {option.label}<small>{option.value}</small>
      </div>)}
      {!filtered.length ? <div role="status">Ничего не найдено</div> : null}
    </div> : null}
  </div>
}
