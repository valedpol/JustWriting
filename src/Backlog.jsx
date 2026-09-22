import './Backlog.css'
import backlogMarkdown from './data/backlog.md?raw'

const tasks = backlogMarkdown
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => line.replace(/^\d+[.)]\s+/, ''))
  .filter(Boolean)

function Backlog() {
  return (
    <main className="backlog-page">
      <div className="backlog-content">
        <header className="backlog-header">
          <h1>Жизнь — единственный продакт, который умеет закрывать задачи без нашего согласия</h1>
          <p>Backlog…</p>
        </header>

        <ol className="backlog-list">
          {tasks.map((task, index) => (
            <li key={`${index}-${task}`}>{task}</li>
          ))}
        </ol>
        <p className="backlog-signature">© Samsara Art Department (SAD)</p>
      </div>
    </main>
  )
}

export default Backlog
