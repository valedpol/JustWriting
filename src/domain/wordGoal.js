import { getWordCount } from './wordCount.js'

export function initialDayGoal(goal = null) {
  return { dailyWordGoal: goal ?? null, goalReached: false, goalReachedAt: null, goalAtReach: null }
}

export function updateDayGoal(day, goal, content, now) {
  if (!['open', 'grace'].includes(day.state) || now < day.startsAt || now >= (day.state === 'grace' ? day.graceUntil : day.endsAt)) return day
  const reached = !day.goalReached && Number.isSafeInteger(goal) && goal > 0 && getWordCount(content) >= goal
  if (day.dailyWordGoal === goal && !reached) return day
  return {
    ...day, dailyWordGoal: goal, revision: day.revision + 1,
    ...(reached ? { goalReached: true, goalReachedAt: now, goalAtReach: goal } : {}),
  }
}
