export function getWordCount(value) {
  if (!value || !value.trim()) {
    return 0
  }

  return value
    .replace(/\*\*|__|\*|_|<u>|<\/u>|[-#•*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length
}

