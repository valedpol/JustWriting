import { useState } from 'react'

const linkNames = ['Telegram', 'Instagram', 'Facebook', 'YouTube', 'X']

export default function PublicProfileSettings({ identity, disabled, onSave }) {
  const [aboutDraft, setAbout] = useState(null), [linksDraft, setLinks] = useState(null)
  const about = aboutDraft ?? identity?.about ?? ''
  const links = linksDraft ?? (identity?.links ?? []).map(link => ({ link, isNew: false }))
  const updateLink = (index, field, value) => setLinks(links.map((row, i) => i === index ? { ...row, link: { ...row.link, [field]: value } } : row))
  const saveAbout = async () => {
    if (disabled || about === (identity?.about ?? '')) return
    if (await onSave('about', about)) setAbout(null)
  }
  const saveLinks = async () => { if (!disabled && await onSave('links', links.map(row => row.link))) setLinks(null) }
  return <section aria-labelledby="settings-public-profile">
    <h2 id="settings-public-profile">Публичный профиль</h2>
    <label className="settings-row"><span>Показывать публичный профиль</span><input type="checkbox" checked={identity?.profileVisible ?? false}
      disabled={disabled} onChange={event => onSave('profileVisible', event.target.checked)} /></label>
    <label className="settings-row"><span>О себе</span><span className="settings-about-field">
      <textarea rows="3" maxLength={300} value={about} disabled={disabled}
        onChange={event => {
          const value = event.target.value
          setAbout(value.length > 300 ? value.slice(0, 300).replace(/[\uD800-\uDBFF]$/, '') : value)
        }} onBlur={saveAbout} aria-describedby="public-about-limit" />
      <span id="public-about-limit" className="settings-note settings-about-count">{about.length} / 300</span>
    </span></label>
    <p className="settings-note">Эти ссылки будут видны в твоём публичном профиле.</p>
    {links.map(({ link, isNew }, index) => <div className={`settings-resource ${isNew ? 'public-link-new' : 'public-link-saved'}`} key={index}>
      <label>{isNew ? 'Название' : null}<input aria-label={`Название публичной ссылки ${index + 1}`} value={link.label} disabled={disabled} onChange={event => updateLink(index, 'label', event.target.value)} /></label>
      <label>{isNew ? 'URL' : null}<input aria-label={`URL публичной ссылки ${index + 1}`} type="url" placeholder="https://" value={link.url} disabled={disabled} onChange={event => updateLink(index, 'url', event.target.value)} /></label>
      <button className="public-link-delete" type="button" disabled={disabled} aria-label={`Удалить публичную ссылку ${index + 1}`} onClick={() => setLinks(links.filter((_, i) => i !== index))}>Удалить</button>
      {isNew ? <div className="public-link-presets" role="group" aria-label="Быстрый выбор названия ссылки">
        {linkNames.map(name => <button type="button" key={name} disabled={disabled} onClick={() => updateLink(index, 'label', name)}>{name}</button>)}
      </div> : null}
    </div>)}
    <div className="public-links-actions">
      <button type="button" disabled={disabled} onClick={() => setLinks([...links, { link: { label: '', url: '' }, isNew: true }])}>Добавить ссылку</button>
      <button type="button" disabled={disabled || linksDraft === null} onClick={saveLinks}>Сохранить ссылки</button>
    </div>
  </section>
}
