const sections = [
  { id: 'statistics', label: 'Статистика', available: true },
  { id: 'meanings', label: 'Смыслы', available: false },
]

export default function ResearchNavigation({ onExit }) {
  return <nav className="side-menu research-local-menu" aria-label="Исследования">
    <span className="menu-item">Исследования</span>
    <div className="research-local-children">
      {sections.map((section) => <button key={section.id} type="button"
        className={`menu-item${section.id === 'statistics' ? ' is-active' : ''}`}
        aria-current={section.id === 'statistics' ? 'page' : undefined}
        disabled={!section.available}>
        {section.label}
      </button>)}
    </div>
    <button type="button" className="menu-item research-local-exit" aria-label="Выйти из Исследований к Тексту сегодня" onClick={onExit}>←</button>
  </nav>
}
