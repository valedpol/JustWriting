const labels = { tag: 'Тег', title: 'Название' }

export function SemanticCategories({ panel, chooseCategory }) {
  return <>
        {(panel?.source === 'slash' ? ['tag', 'title'] : ['title', 'tag']).map(category => <button key={category} aria-pressed={panel?.category === category} onClick={() => chooseCategory(category)}>{labels[category]}</button>)}
  </>
}

export default function SemanticPicker({ panel, queryInput, suggestions, setPanel, applyValue, cancelPanel }) {
  return <>
      {panel?.category ? <div className="semantic-picker">
        <input ref={queryInput} aria-label={`Найти или создать: ${labels[panel.category]}`} value={panel.query}
          onChange={event => setPanel({ ...panel, query: event.target.value })}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); cancelPanel(true) }
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); applyValue(suggestions.find(item => item.value === panel.query.trim()) ?? { value: panel.query }) }
          }} />
        <div className="semantic-suggestions">{suggestions.map(item => <button key={item.value} onMouseDown={event => event.preventDefault()} onClick={() => applyValue(item)}>{panel.category === 'tag' ? '#' : ''}{item.value}</button>)}</div>
        {panel.query.trim() && !suggestions.some(item => item.value === panel.query.trim()) ? <button onMouseDown={event => event.preventDefault()} onClick={() => applyValue({ value: panel.query })}>Создать «{panel.query.trim()}»</button> : null}
        <button onMouseDown={event => event.preventDefault()} onClick={() => cancelPanel(true)}>Отмена</button>
      </div> : null}
  </>
}
