import { useSourcePublications } from '../hooks/useArchivePublications.js'

export default function ArchivePublicationSummary({ record }) {
  const { records } = useSourcePublications(record)
  return records.length ? <div className="archive-publication-summary">↗ Публикация</div> : null
}
