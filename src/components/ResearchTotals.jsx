const number = value => value.toLocaleString('ru-RU')
const plural = (n, one, few, many) => n % 100 >= 11 && n % 100 <= 14 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many

export default function ResearchTotals({ data, backupCount }) {
  return <div className="research-statistics"><div className="research-totals">
    <div><strong>{number(data.writingDays)}</strong><span>{plural(data.writingDays, 'день письма', 'дня письма', 'дней письма')}</span></div>
    <div><strong>{number(data.totalWords)}</strong><span>слов</span></div>
    <div><strong>{number(data.streak)}</strong><span>{plural(data.streak, 'день подряд', 'дня подряд', 'дней подряд')}</span></div>
    <div><strong>{number(data.tagCount)}</strong><span>{plural(data.tagCount, 'тег', 'тега', 'тегов')}</span></div>
    <div><strong>{number(data.titleCount)}</strong><span>{plural(data.titleCount, 'название', 'названия', 'названий')}</span></div>
    <div><strong>{number(backupCount)}</strong><span>{plural(backupCount, 'бэкап', 'бэкапа', 'бэкапов')}</span></div>
  </div>
    <div className="research-publication-totals" role="group" aria-label="Публикации">
      {[['profile', 'в профиле'], ['feed', 'в ленте']].map(([channel, label]) => <div key={channel}>
        <strong>{number(data.publicationCounts?.[channel] ?? 0)}</strong><span>{label}</span>
      </div>)}
    </div>
  </div>
}
