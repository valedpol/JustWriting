export default function WordCounter({ count, goal }) {
  const hasGoal = goal != null
  const reached = hasGoal && count >= goal
  return <span className="word-counter">
    {count}{hasGoal
      ? <span className={reached ? undefined : 'word-counter-goal-pending'}> / {goal} слов</span>
      : ' слов'}
  </span>
}
