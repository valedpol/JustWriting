// Compare boundaries, not selected strings: identical fragments elsewhere in
// the document must not be mistaken for a selection of the whole day.
export function coversWholeText(root, selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1 || !root.textContent) return false
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false
  const before = root.ownerDocument.createRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  const after = root.ownerDocument.createRange()
  after.selectNodeContents(root)
  after.setStart(range.endContainer, range.endOffset)
  return before.toString() === '' && after.toString() === ''
}
