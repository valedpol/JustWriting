const dateLabel = key => key.split('-').reverse().join('.')

export default function ArchiveSemanticSelector({ page, index, selected, onSelect, onBack, busy }) {
  const titles = page === 'title'
  const items = titles ? index.titles : index.tags
  return <nav className="side-menu archive-semantic-selector" aria-label={titles ? 'Названия в архиве' : 'Теги в архиве'}>
    <div className="archive-semantic-selector-heading">
      <button type="button" className="menu-item" aria-label="Вернуться к навигации Моих текстов" disabled={busy} onClick={onBack}>←</button>
      <span className="menu-item">{titles ? 'Названия' : 'Теги'}</span>
    </div>
    <div className="archive-semantic-list-scroll">
      {index.errors.length ? <p role="status">Не удалось прочитать разметку: {index.errors.map(dateLabel).join(', ')}.</p> : null}
      {items.length ? <ul>{items.map(item => {
        const id = titles ? item.id : item.value
        return <li key={id}><button type="button" className={`menu-item${selected === id ? ' is-active' : ''}`}
          aria-current={selected === id ? 'true' : undefined} disabled={busy} onClick={() => onSelect(id)}
          title={titles ? `Написано ${dateLabel(item.dayKey)}` : undefined} data-semantic-item={titles ? item.markupId : item.value}>
          <span>{item.value}</span>{titles ? null : <span className="archive-semantic-count">{item.count}</span>}
        </button></li>
      })}</ul> : <p>{titles ? 'Названий пока нет.' : 'Тегов пока нет.'}</p>}
    </div>
  </nav>
}
