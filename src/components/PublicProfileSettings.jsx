import { useState } from 'react'

export default function PublicProfileSettings({ identity, disabled, onSave }) {
  const [aboutDraft, setAbout] = useState(null), [linksDraft, setLinks] = useState(null)
  const about = aboutDraft ?? identity?.about ?? '', links = linksDraft ?? identity?.links ?? []
  const updateLink = (index, field, value) => setLinks(links.map((link, i) => i === index ? { ...link, [field]: value } : link))
  const saveAbout = async () => {
    if (disabled || about === (identity?.about ?? '')) return
    if (await onSave('about', about)) setAbout(null)
  }
  const saveLinks = async () => { if (!disabled && await onSave('links', links)) setLinks(null) }
  return <section aria-labelledby="settings-public-profile">
    <h2 id="settings-public-profile">Публичный профиль</h2>
    <label className="settings-row"><span>Показывать публичный профиль</span><input type="checkbox" checked={identity?.profileVisible ?? false}
      disabled={disabled} onChange={event => onSave('profileVisible', event.target.checked)} /></label>
    <label className="settings-row"><span>О себе</span><textarea rows="3" value={about} disabled={disabled}
      onChange={event => setAbout(event.target.value)} onBlur={saveAbout} aria-describedby="public-about-limit" /></label>
    <p id="public-about-limit" className="settings-note">До 300 символов.</p>
    <p className="settings-note">Эти ссылки будут видны в твоём публичном профиле.</p>
    {links.map((link, index) => <div className="settings-resource" key={index}>
      <label>Название<input value={link.label} disabled={disabled} onChange={event => updateLink(index, 'label', event.target.value)} /></label>
      <label>URL<input type="url" placeholder="https://" value={link.url} disabled={disabled} onChange={event => updateLink(index, 'url', event.target.value)} /></label>
      <button type="button" disabled={disabled} aria-label={`Удалить публичную ссылку ${index + 1}`} onClick={() => setLinks(links.filter((_, i) => i !== index))}>Удалить</button>
    </div>)}
    <div className="public-links-actions">
      <button type="button" disabled={disabled} onClick={() => setLinks([...links, { label: '', url: '' }])}>Добавить ссылку</button>
      <button type="button" disabled={disabled || linksDraft === null} onClick={saveLinks}>Сохранить ссылки</button>
    </div>
  </section>
}
