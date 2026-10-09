import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadPublicProfile } from '../storage/publicProfileRepository.js'
import { wordCountNoun } from '../domain/wordCount.js'
import PublicationView from './PublicationView.jsx'
import './PublicProfileView.css'

const profileApi = { load: loadPublicProfile }
const shortDate = value => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(value)
const dayNoun = count => count % 100 >= 11 && count % 100 <= 14 ? 'дней письма' : count % 10 === 1 ? 'день письма' : count % 10 >= 2 && count % 10 <= 4 ? 'дня письма' : 'дней письма'
const textNoun = count => count % 100 >= 11 && count % 100 <= 14 ? 'текстов' : count % 10 === 1 ? 'текст' : count % 10 >= 2 && count % 10 <= 4 ? 'текста' : 'текстов'

export default function PublicProfileView({ publicId, metadataHost, authorInfoHost, statusHost, onLoaded, api = profileApi }) {
  const [profile, setProfile] = useState(undefined), [error, setError] = useState('')
  useEffect(() => {
    let live = true, generation = 0
    const reload = async () => {
      const request = ++generation
      try {
        const next = await api.load(publicId)
        if (!live || request !== generation) return
        setProfile(next); setError(''); onLoaded?.(next)
      } catch {
        if (live && request === generation) { setProfile(null); setError('Не удалось загрузить профиль.') }
      }
    }
    reload(); window.addEventListener('focus', reload)
    return () => { live = false; window.removeEventListener('focus', reload) }
  }, [publicId, api, onLoaded])
  const introduction = profile ? <div className="public-profile-introduction">
    {profile.fullName ? <p className="public-profile-name">{profile.fullName}</p> : null}
    {profile.stats ? <div className="public-profile-writing">
      {profile.stats.joinedAt != null ? <p className="public-profile-since">
        в проекте с <time dateTime={new Date(profile.stats.joinedAt).toISOString()}>{shortDate(profile.stats.joinedAt)}</time>
      </p> : null}
      <div className="public-profile-totals">
        <div><strong>{profile.stats.writingDays.toLocaleString('ru-RU')}</strong><span>{dayNoun(profile.stats.writingDays)}</span></div>
        <div><strong>{profile.stats.totalWords.toLocaleString('ru-RU')}</strong><span>{wordCountNoun(profile.stats.totalWords)}</span></div>
      </div>
    </div> : null}
    {profile.about.trim() ? <div className="public-profile-about-block">
      <h2 className="public-profile-service-heading">О себе</h2>
      <p className="public-profile-about">{profile.about}</p>
    </div> : null}
    {profile.links.length ? <div className="public-profile-links">{profile.links.map((link, i) => <a key={`${link.url}:${i}`} href={link.url} target="_blank" rel="noopener noreferrer">{link.label}<span aria-hidden="true"> ↗</span></a>)}</div> : null}
  </div> : null
  return <><div className="public-profile-view"><PublicationView records={profile === undefined ? null : profile?.publications ?? []}
    renderPublicationLabel={record => record.publicationId === profile?.pinnedPublicationId ? <span className="public-profile-pinned">Закреплено</span> : null}
    compactPreview stickyPublicationId={profile?.pinnedPublicationId} error={error} metadataHost={metadataHost} ariaLabel="Публичный профиль"
    emptyMessage={profile ? 'Автор не готов делиться текстами.' : 'Профиль недоступен.'} /></div>
    {authorInfoHost ? createPortal(introduction, authorInfoHost) : null}
    {profile && statusHost ? createPortal(<span className="footer-status-text" role="status">Опубликовано {profile.publications.length} {textNoun(profile.publications.length)}</span>, statusHost) : null}</>
}
