import { useCallback, useEffect, useRef, useState } from 'react'
import { createUserBackupService } from '../backup/userBackup.js'
import { createLastVerifiedBackupStore } from '../backup/lastVerifiedBackup.js'
import { downloadFile } from '../utils/files.js'

function backupDate(timestamp) {
  const date = new Date(timestamp)
  const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date).replace(' г.', '')
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date)
  return `${day}, ${time}`
}

function textCountLabel(count) {
  if (count % 100 >= 11 && count % 100 <= 14) return 'текстов'
  return count % 10 === 1 ? 'текст' : count % 10 >= 2 && count % 10 <= 4 ? 'текста' : 'текстов'
}

function errorMessage(error) {
  const message = error.message || String(error)
  if (/Maintenance lock unavailable|close other application tabs/.test(message)) return 'Закройте другие вкладки JW. Вернитесь к работе без проверки, затем повторите создание копии.'
  if (/Disk checkpoint differs/.test(message)) return 'Выбранный файл не совпадает с созданной копией. Выберите именно сохранённый файл этой копии.'
  if (/Invalid backup|JSON/.test(message)) return 'Файл повреждён или не является поддерживаемой резервной копией JW.'
  return message
}

export default function BackupData({ assertCanCreate, onActiveChange = () => {}, service: suppliedService, download = downloadFile, metadataStore: suppliedMetadataStore }) {
  const [service] = useState(() => suppliedService ?? createUserBackupService())
  const [metadataStore] = useState(() => suppliedMetadataStore ?? createLastVerifiedBackupStore())
  const [lastVerified, setLastVerified] = useState(() => metadataStore.read())
  const [phase, setPhase] = useState('idle')
  const [message, setMessage] = useState('')
  const [checkpoint, setCheckpoint] = useState(null)
  const input = useRef(null)
  const downloadURL = useRef(null)
  const busy = phase === 'creating' || phase === 'verifying'
  const maintenanceActive = service.status().localPhase !== 'normal'
  const details = checkpoint ? { ...checkpoint.receipt, filename: checkpoint.filename } : lastVerified
  useEffect(() => {
    if (!maintenanceActive && !busy) return
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [maintenanceActive, busy])
  useEffect(() => () => { if (downloadURL.current) URL.revokeObjectURL(downloadURL.current) }, [])
  const create = async () => {
    setPhase('creating'); setMessage('Создаю резервную копию…'); onActiveChange(true)
    try {
      const captured = await service.create(assertCanCreate)
      setCheckpoint(captured)
      const filename = `just-writing-backup-${new Date(captured.receipt.capturedAt).toISOString().replace(/[:.]/g, '-')}.json`
      setCheckpoint({ ...captured, filename })
      if (downloadURL.current) URL.revokeObjectURL(downloadURL.current)
      downloadURL.current = download(captured.file, filename).url
      setPhase('awaiting')
      setMessage('Сохраните файл. Затем выберите сохранённую копию с диска для проверки. Скачивание ещё не означает, что копия проверена.')
    } catch (error) {
      setPhase('error'); setMessage(errorMessage(error))
      onActiveChange(service.status().localPhase !== 'normal')
    }
  }
  const resume = useCallback(async (text = 'Проверка отменена. Резервная копия не проверена.') => {
    try {
      if (service.status().localPhase !== 'normal') await service.resume()
      setCheckpoint(null); setPhase('idle'); setMessage(text); onActiveChange(false)
    } catch (error) { setPhase('error'); setMessage(errorMessage(error)) }
  }, [service, onActiveChange])
  useEffect(() => {
    const element = input.current
    const cancel = () => { resume() }
    element.addEventListener('cancel', cancel)
    return () => element.removeEventListener('cancel', cancel)
  }, [resume])
  const selectedFile = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) { await resume(); return }
    setPhase('verifying'); setMessage('Проверяю файл и восстановление в отдельную тестовую базу…')
    onActiveChange(true)
    try {
      const verified = await service.verify(file, checkpoint?.receipt)
      setCheckpoint(null)
      try { setLastVerified(metadataStore.save(verified)) }
      catch {
        setPhase('error'); setMessage('Резервная копия проверена, но не удалось сохранить сведения в Аккаунте. Предыдущие сведения сохранены.'); onActiveChange(false)
        return
      }
      setPhase('verified'); setMessage('Резервная копия проверена'); onActiveChange(false)
    } catch (error) {
      setPhase('error'); setMessage(`Копия не проверена: ${errorMessage(error)}`)
      onActiveChange(service.status().localPhase !== 'normal')
    }
  }
  return <div className="backup-data" aria-labelledby="settings-data">
    <h3 id="settings-data">Данные</h3>
    <p className="settings-note">Полная копия сохранённых текстов, форматирования, тегов, названий, настроек и данных статистики в этом браузере.</p>
    <div className="backup-actions">
      <button type="button" disabled={busy || maintenanceActive || Boolean(checkpoint)} onClick={create}>Создать резервную копию</button>
      <button type="button" disabled={busy} onClick={() => input.current.click()}>Проверить резервную копию</button>
    </div>
    <input ref={input} type="file" accept=".json,application/json" hidden aria-label="Выбрать резервную копию с диска"
      onChange={selectedFile} />
    {maintenanceActive ? <p className="settings-note">До завершения проверки запись в JW приостановлена. Не закрывайте и не перезагружайте вкладку.</p> : null}
    {message ? <p role={phase === 'error' ? 'alert' : 'status'}>{message}</p> : null}
    {!busy && (maintenanceActive || checkpoint) ? <button type="button" onClick={() => resume('Проверка не завершена. JW возвращён в обычный режим.')}>Вернуться к работе без проверки</button> : null}
    {lastVerified ? <div className="backup-last-verified">
      <strong>Последняя проверенная копия</strong>
      <p>{backupDate(lastVerified.capturedAt)} · {lastVerified.counts.texts} {textCountLabel(lastVerified.counts.texts)}</p>
    </div> : null}
    {details ? <>
      <details><summary>Технические сведения</summary><dl>
        <dt>Файл</dt><dd>{details.filename}</dd><dt>Размер</dt><dd>{details.byteSize} байт</dd>
        <dt>SHA-256</dt><dd>{details.sha256}</dd><dt>Origin</dt><dd>{details.origin}</dd>
        <dt>Создана</dt><dd>{new Date(details.capturedAt).toLocaleString('ru-RU')}</dd>
        <dt>Версия базы</dt><dd>{details.dbVersion}</dd>
        {details.restoreVerified ? <><dt>Проверена</dt><dd>{new Date(details.verifiedAt).toLocaleString('ru-RU')}</dd>
          <dt>Тестовая база</dt><dd>{details.isolatedRestoreName}</dd>
          <dt>Restore / reopen</dt><dd>{details.restoreVerified ? 'PASS' : 'FAIL'}</dd>
          <dt>Тестовая база удалена</dt><dd>{details.isolatedRestoreDeleted ? 'Да' : 'Нет'}</dd></> : null}
        {Object.entries(details.counts).map(([name, count]) => <div key={name}><dt>{name}</dt><dd>{count}</dd></div>)}
      </dl></details>
    </> : null}
  </div>
}
