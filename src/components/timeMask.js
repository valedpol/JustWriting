const positions = [0, 1, 3, 4]
export function editTime(value, start, end, input = '', deletion = null) {
  const chars = (value || '__:__').split('')
  for (const pos of positions) if (pos >= start && pos < end) chars[pos] = '_'
  let cursor = start
  if (deletion && start === end) {
    const pos = deletion === 'backward'
      ? positions.filter((p) => p < start).at(-1)
      : positions.find((p) => p >= start)
    if (pos !== undefined) { chars[pos] = '_'; cursor = pos }
  } else if (input) {
    if (!/^[\d:]+$/.test(input)) return null
    const digits = input.replaceAll(':', '')
    const slots = positions.filter((p) => p >= start)
    if (digits.length > slots.length) return null
    for (let i = 0; i < digits.length; i++) { chars[slots[i]] = digits[i]; cursor = slots[i] + 1 }
    if (cursor === 2) cursor = 3
  }
  chars[2] = ':'
  if (chars[0] !== '_' && Number(chars[0]) > 2) return null
  if (chars[0] === '2' && chars[1] !== '_' && Number(chars[1]) > 3) return null
  if (chars[3] !== '_' && Number(chars[3]) > 5) return null
  return { value: chars.join(''), cursor }
}
