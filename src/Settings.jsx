import { useState } from 'react'
import { createPortal } from 'react-dom'
import './Settings.css'
import TimeInput from './components/TimeInput.jsx'
import TimezoneSelect from './components/TimezoneSelect.jsx'
import BackupData from './components/BackupData.jsx'
import { parseDayStart, formatDayStart } from './domain/writingDay.js'

const networks = ['Telegram', 'Instagram', 'Facebook', 'VK', 'YouTube']

// Name, day start and word goal persist; other controls remain a visual prototype.
export default function Settings({ profile, onSave, statusHost, assertCanCreateBackup, onBackupActiveChange }) {
  const [nameDraft, setName] = useState(null)
  const [dayStartDraft, setDayStart] = useState(null)
  const name = nameDraft ?? profile?.displayName ?? ''
  const dayStart = dayStartDraft ?? formatDayStart(profile?.dayStartMinutes ?? 0)
  const [timeError, setTimeError] = useState('')
  const formatError = 'Введите время в формате ЧЧ:ММ, например 01:00.'
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [backupActive, setBackupActive] = useState(false)
  const save = async (field) => {
    if (!profile || saving) return
    try {
      const value = field === 'displayName' ? name : parseDayStart(dayStart)
      if (value === profile[field]) { if (field === 'dayStartMinutes') setTimeError(''); return }
      setSaving(true)
      setMessage('Сохраняю…')
      const result = await onSave(field, value)
      if (field === 'displayName') setName(null)
      else { setDayStart(null); setTimeError('') }
      setMessage(result.deferred ? 'Сохранено. Новое начало дня применяется со следующего периода; текущая граница не изменена.' : 'Сохранено')
    } catch (error) {
      if (field === 'dayStartMinutes') { setTimeError(error.message.startsWith('Введите время') ? formatError : error.message); setMessage('') }
      else setMessage(error.message)
    }
    finally { setSaving(false) }
  }
  const enter = (event) => { if (event.key === 'Enter') event.currentTarget.blur() }

  const [socialLinks, setSocialLinks] = useState({})
  const [resources, setResources] = useState([])
  const [wordGoalDraft, setWordGoal] = useState(null)
  const wordGoal = wordGoalDraft ?? String(profile?.dailyWordGoal ?? '')
  const [goalError, setGoalError] = useState('')
  const saveGoal = async () => {
    if (!profile || saving) return
    try {
      if (wordGoal !== '' && (!/^\d+$/.test(wordGoal) || !Number.isSafeInteger(Number(wordGoal)) || Number(wordGoal) <= 0)) {
        throw new Error('Введите целое положительное число или оставьте поле пустым.')
      }
      const value = wordGoal === '' ? null : Number(wordGoal)
      if (value === (profile.dailyWordGoal ?? null)) { setGoalError(''); return }
      setSaving(true)
      setMessage('Сохраняю…')
      await onSave('dailyWordGoal', value)
      setWordGoal(null)
      setGoalError('')
      setMessage('Сохранено')
    } catch (error) {
      setGoalError(error.message)
      setMessage('')
    } finally { setSaving(false) }
  }
  const [timezoneDraft, setTimezoneDraft] = useState(null)

  const updateResource = (id, field, value) => {
    setResources((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item))
  }

  return <div className="settings-content">
    <h1>Настройки</h1>
    {statusHost ? createPortal(<span className="footer-status-text" role="status" title={message}>{message.startsWith('Сохранено') ? 'Сохранено' : message}</span>, statusHost) : null}

    <section aria-labelledby="settings-profile">
      <h2 id="settings-profile">Профиль</h2>
      <label className="settings-row"><span>Имя</span><input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => save('displayName')} onKeyDown={enter} disabled={!profile || saving || backupActive} autoComplete="off" /></label>
      <label className="settings-row"><span>Email</span><input type="email" placeholder="name@example.com" autoComplete="off" /></label>
      <div className="settings-row"><span>Подтверждение email</span><span className="settings-note">Нет данных о подтверждении</span></div>
    </section>

    <section aria-labelledby="settings-writing">
      <h2 id="settings-writing">Письмо</h2>
      <div className="settings-row"><label htmlFor="settings-day-start">Начало дня</label><div className="settings-time-field"><TimeInput id="settings-day-start" value={dayStart} onChange={(value) => { setDayStart(value); setTimeError('') }} onInvalid={() => setTimeError(formatError)} onBlur={() => save('dayStartMinutes')} onKeyDown={enter} disabled={!profile || saving || backupActive} aria-invalid={Boolean(timeError)} aria-describedby="settings-time-format" />
      <p id="settings-time-format" className={`settings-note settings-field-note${timeError ? ' settings-error' : ''}`} role={timeError ? 'alert' : undefined}>{timeError || 'Формат 24 часа — ЧЧ:ММ'}</p>
      </div></div>
      <div className="settings-row">
        <label htmlFor="settings-timezone">Часовой пояс</label>
        <TimezoneSelect id="settings-timezone" value={timezoneDraft ?? profile?.timeZone ?? 'Europe/Moscow'} onChange={setTimezoneDraft} />
      </div>
      <div className="settings-row"><label htmlFor="settings-word-goal">Дневная норма слов</label>
        <div className="settings-time-field">
          <input id="settings-word-goal" type="text" inputMode="numeric" placeholder="Без нормы" value={wordGoal}
            onChange={(event) => { setWordGoal(event.target.value); setGoalError('') }}
            onBlur={saveGoal} onKeyDown={enter} disabled={!profile || saving || backupActive}
            aria-invalid={Boolean(goalError)} aria-describedby={goalError ? 'settings-goal-error' : undefined} />
          {goalError ? <p id="settings-goal-error" className="settings-note settings-field-note settings-error" role="alert">{goalError}</p> : null}
        </div>
      </div>
    </section>

    <section aria-labelledby="settings-social">
      <h2 id="settings-social">Социальные сети</h2>
      <p className="settings-note">Ссылки не публикуются.</p>
      {networks.map((network) => <div className="settings-row" key={network}>
        <label htmlFor={`social-${network}`}>{network}</label>
        {Object.hasOwn(socialLinks, network) ? <div className="settings-link-value">
          <input id={`social-${network}`} type="url" placeholder="https://" value={socialLinks[network]} onChange={(event) => setSocialLinks((links) => ({ ...links, [network]: event.target.value }))} />
          <button type="button" aria-label={`Удалить ссылку ${network}`} onClick={() => setSocialLinks((links) => {
            const next = { ...links }; delete next[network]; return next
          })}>Удалить</button>
        </div> : <button type="button" aria-label={`Добавить ссылку ${network}`} onClick={() => setSocialLinks((links) => ({ ...links, [network]: '' }))}>Добавить ссылку</button>}
      </div>)}
    </section>

    <section aria-labelledby="settings-resources">
      <h2 id="settings-resources">Другие ресурсы</h2>
      <p className="settings-note">Ссылки не публикуются.</p>
      {resources.map((resource, index) => <div className="settings-resource" key={resource.id}>
        <label>Название<input value={resource.name} placeholder="Личный сайт" onChange={(event) => updateResource(resource.id, 'name', event.target.value)} /></label>
        <label>URL<input type="url" value={resource.url} placeholder="https://" onChange={(event) => updateResource(resource.id, 'url', event.target.value)} /></label>
        <button type="button" aria-label={`Удалить ресурс ${index + 1}`} onClick={() => setResources((items) => items.filter((item) => item.id !== resource.id))}>Удалить</button>
      </div>)}
      <button type="button" onClick={() => setResources((items) => [...items, { id: crypto.randomUUID(), name: '', url: '' }])}>Добавить ресурс</button>
    </section>

    <section aria-labelledby="settings-account">
      <h2 id="settings-account">Аккаунт</h2>
      <div className="settings-row"><span>Уровень аккаунта</span><span className="settings-note">Не назначен</span></div>
      <BackupData onActiveChange={active => { setBackupActive(active); onBackupActiveChange?.(active) }} assertCanCreate={() => {
        if (saving) throw new Error('Дождитесь завершения сохранения настроек.')
        if (timeError || goalError) throw new Error('Исправьте ошибку настройки перед созданием копии.')
        assertCanCreateBackup?.()
      }} />
    </section>
  </div>
}
