// Only the replacement's inserted part crosses into the next day.
export function insertedText(before, after) {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  return after.slice(prefix, after.length - suffix)
}
