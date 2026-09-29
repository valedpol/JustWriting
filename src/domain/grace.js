export const GRACE_DURATION = 60 * 60 * 1000

export function advanceDay(day, now) {
  if (day.state === 'closed') return day
  if (day.state === 'open' && now < day.endsAt) return day
  if (day.state === 'open' && day.writingSessionId && now < day.endsAt + GRACE_DURATION) {
    return { ...day, state: 'grace', graceUntil: day.endsAt + GRACE_DURATION,
      graceSessionId: day.writingSessionId, revision: day.revision + 1 }
  }
  if (day.state === 'grace' && now < day.graceUntil) return day
  return { ...day, state: 'closed', closedAt: day.graceUntil ?? day.endsAt, revision: day.revision + 1 }
}

export function canWriteDay(day, now, sessionId = null) {
  return now >= day.startsAt && (
    (day.state === 'open' && now < day.endsAt) ||
    (day.state === 'grace' && Boolean(sessionId) && day.graceSessionId === sessionId && now < day.graceUntil)
  )
}
