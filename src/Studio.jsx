import philosophy from './content/philosophy.md?raw'
import whitePaper from './content/white-paper.md?raw'
import artifact from './content/artifact.md?raw'
import studioPlan from './content/studio-plan.md?raw'
import StudioMarkdown from './components/StudioMarkdown.jsx'
import './Studio.css'

const sections = [
  { id: 'philosophy', label: 'Философия', content: philosophy },
  { id: 'white-paper', label: 'White paper', content: whitePaper },
  { id: 'plan', label: 'План студии', content: studioPlan },
  { id: 'artifact', label: 'Артефакты', content: artifact, separate: true },
]

export function StudioNavigation({ view = 'philosophy', onSelect, onExit }) {
  return <nav className="side-menu studio-local-menu" aria-label="Студия">
    <span className="menu-item">Студия</span>
    <div className="studio-local-children">
      {sections.map(section => <button key={section.id} type="button"
        className={`menu-item${section.separate ? ' navigation-group-start' : ''}${section.id === view ? ' is-active' : ''}`}
        aria-current={section.id === view ? 'page' : undefined}
        onClick={() => onSelect(section.id)}>{section.label}</button>)}
      <button type="button" className="menu-item" disabled>Библиотека</button>
    </div>
    <button type="button" className="menu-item studio-local-exit" aria-label="Выйти из Студии к Тексту сегодня" onClick={onExit}>←</button>
  </nav>
}

export default function Studio({ view = 'philosophy' }) {
  const section = sections.find(section => section.id === view)
  return <StudioMarkdown content={section?.content ?? ''} label={section?.label} />
}
