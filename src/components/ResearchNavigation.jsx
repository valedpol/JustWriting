const sections = [
  { id: 'statistics', label: 'Статистика' },
  { id: 'meanings', label: 'Смыслы' },
]

export default function ResearchNavigation({ onExit, view = 'statistics', onSelect }) {
  return <nav className="side-menu research-local-menu" aria-label="Исследования">
    <span className="menu-item">Исследования</span>
    <div className="research-local-children">
      {sections.map((section) => <button key={section.id} type="button"
        className={`menu-item${section.id === view ? ' is-active' : ''}`}
        aria-current={section.id === view ? 'page' : undefined}
        onClick={() => onSelect?.(section.id)}>
        {section.label}
      </button>)}
    </div>
    <button type="button" className="menu-item research-local-exit" aria-label="Выйти из Исследований к Тексту сегодня" onClick={onExit}>←</button>
  </nav>
}
