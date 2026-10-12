import philosophy from './content/philosophy.md?raw'
import './Studio.css'

const sections = [
  { id: 'philosophy', label: 'Философия' },
  { id: 'white-paper', label: 'White paper' },
  { id: 'artifact', label: 'Артефакт' },
  { id: 'plan', label: 'План студии' },
]

export function StudioNavigation({ view = 'philosophy', onSelect, onExit }) {
  return <nav className="side-menu studio-local-menu" aria-label="Студия">
    <span className="menu-item">Студия</span>
    <div className="studio-local-children">
      {sections.map(section => <button key={section.id} type="button"
        className={`menu-item${section.id === view ? ' is-active' : ''}`}
        aria-current={section.id === view ? 'page' : undefined}
        onClick={() => onSelect(section.id)}>{section.label}</button>)}
    </div>
    <button type="button" className="menu-item studio-local-exit" aria-label="Выйти из Студии к Тексту сегодня" onClick={onExit}>←</button>
  </nav>
}

export default function Studio({ view = 'philosophy' }) {
  return <article className="studio-content" aria-label={sections.find(section => section.id === view)?.label}>
    {view === 'philosophy' ? philosophy.trim().split(/\r?\n\s*\r?\n/).map((paragraph, index) =>
      <p key={index}>{paragraph.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) =>
        part.startsWith('**') && part.endsWith('**') ? <strong key={partIndex}>{part.slice(2, -2)}</strong> : part)}</p>) : null}
  </article>
}
