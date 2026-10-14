const sections = [
  ['today', 'Текст сегодня'],
  ['archive', 'Архив и избранное'],
  ['publications', 'Опубликованные тексты'],
  ['research', 'Исследования'],
  ['settings', 'Настройки'],
  ['studio', 'Студия'],
]

export default function MainNavigation({ section, onSelect }) {
  return <nav className="side-menu main-navigation" aria-label="Главное меню">
    {sections.map(([id, label]) => <button type="button" key={id}
      className={`menu-item${['research', 'settings', 'studio'].includes(id) ? ' navigation-group-start' : ''}${section === id ? ' is-active' : ''}`}
      aria-current={section === id ? 'page' : undefined} onClick={() => onSelect(id)}>{label}</button>)}
  </nav>
}
