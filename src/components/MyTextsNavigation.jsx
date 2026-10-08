const channels = [['profile', 'Профиль'], ['feed', 'Лента'], ['internet', 'Интернет']]
const tools = ['Поиск', 'Названия', 'Теги', 'Публикации']
const noun = (n, forms) => forms[n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2]

export default function MyTextsNavigation({ onExit, searchOpen, onSearchOpen, draft, onDraft, onSubmit, results, activeIndex, onLocate, busy, publicationPage, publicationCounts, onPublicationsOpen, onPublicationChannel, onPublicationsBack }) {
  return <nav className="side-menu research-local-menu my-texts-local-menu" aria-label="Мои тексты">
    <span className="menu-item">Мои тексты</span>
    <div className="research-local-children">
      {publicationPage ? <>
        <span className="menu-item">Публикации</span>
        <div className="owner-publication-channels">
          {channels.map(([channel, label]) => <button type="button" key={channel} className={`menu-item${publicationPage === channel ? ' is-active' : ''}`}
            aria-current={publicationPage === channel ? 'true' : undefined} disabled={busy} onClick={() => onPublicationChannel(channel)}>
            <span className="owner-publication-channel-label">{label}</span><span className="owner-publication-count">{publicationCounts?.[channel] ?? 0}</span>
          </button>)}
        </div>
      </> : searchOpen ? <>
        <span className="menu-item is-active" aria-current="true">Поиск</span>
        <form className="archive-search-form" onSubmit={event => { event.preventDefault(); onSubmit() }}>
          <input aria-label="Поиск по архиву" value={draft} onChange={event => onDraft(event.target.value)} />
          <button type="submit" aria-label="Найти" disabled={busy}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" focusable="false">
              <circle cx="10" cy="10" r="6.5" />
              <path d="m15 15 6 6" />
            </svg>
          </button>
        </form>
        {results ? <div className="archive-search-summary" aria-live="polite">
          <p>{results.occurrences.length} {noun(results.occurrences.length, ['вхождение', 'вхождения', 'вхождений'])} · {results.records.length} {noun(results.records.length, ['текст', 'текста', 'текстов'])}</p>
          <dl>{[['Тексты', 'text'], ['Названия', 'title'], ['Теги', 'tag']].map(([label, entity]) => <div key={entity}><dt>{label}</dt><dd>{results.counts[entity]}</dd></div>)}</dl>
          {results.occurrences.length ? <div className="archive-search-paging">
            <button type="button" aria-label="Предыдущее вхождение" disabled={busy || activeIndex <= 0} onClick={() => onLocate(activeIndex - 1)}>‹</button>
            <span>{activeIndex + 1} из {results.occurrences.length}</span>
            <button type="button" aria-label="Следующее вхождение" disabled={busy || activeIndex >= results.occurrences.length - 1} onClick={() => onLocate(activeIndex + 1)}>›</button>
          </div> : null}
        </div> : null}
      </> : tools.map(label => <button key={label} type="button"
        className={`menu-item${label === 'Публикации' ? ' my-texts-publications' : ''}`} disabled={!['Поиск', 'Публикации'].includes(label) || busy}
        onClick={label === 'Поиск' ? () => onSearchOpen(true) : label === 'Публикации' ? onPublicationsOpen : undefined}>
        {label}
      </button>)}
    </div>
    <button type="button" className="menu-item research-local-exit"
      disabled={busy}
      aria-label={publicationPage ? 'Вернуться в Мои тексты' : searchOpen ? 'Вернуться к навигации Моих текстов' : 'Выйти из Моих текстов к Тексту сегодня'}
      onClick={publicationPage ? onPublicationsBack : searchOpen ? () => onSearchOpen(false) : onExit}>←</button>
  </nav>
}
