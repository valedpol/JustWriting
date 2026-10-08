// Measure the already-rendered immutable snapshot, never its archive source.
// DOM fragments preserve the renderer's marks and paragraph/line-break structure.
export function publicationPreview(container) {
  const doc = container.ownerDocument
  const walker = doc.createTreeWalker(container, 5) // SHOW_ELEMENT | SHOW_TEXT
  const items = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.nodeType === 3 && node.length) {
      const range = doc.createRange()
      range.selectNodeContents(node)
      items.push({ node, rects: [...range.getClientRects()].filter(rect => rect.height > 0) })
    } else if (node.nodeType === 1 && ['BR', 'HR'].includes(node.tagName)) {
      items.push({ node, rects: [...node.getClientRects()].filter(rect => rect.height > 0) })
    }
  }
  const lines = []
  for (const rect of items.flatMap(item => item.rects).sort((a, b) => a.top - b.top)) {
    const previous = lines.at(-1)
    if (previous && Math.abs(previous.top - rect.top) < 3) previous.bottom = Math.max(previous.bottom, rect.bottom)
    else lines.push({ top: rect.top, bottom: rect.bottom })
  }
  if (lines.length <= 6) return { head: container.cloneNode(true), tail: null }

  const point = (node, offset) => {
    // Avoid cloning an empty paragraph/mark at a line boundary.
    while (offset === 0 && node !== container) {
      offset = [...node.parentNode.childNodes].indexOf(node)
      node = node.parentNode
    }
    return [node, offset]
  }
  const boundary = top => {
    for (const { node, rects } of items) {
      if (!rects.length || rects.at(-1).top < top - 1) continue
      if (node.nodeType === 1) return point(node.parentNode, [...node.parentNode.childNodes].indexOf(node))
      let low = 0, high = node.length
      const range = doc.createRange()
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        range.setStart(node, middle); range.setEnd(node, middle + 1)
        if (range.getBoundingClientRect().top < top - 1) low = middle + 1
        else high = middle
      }
      return point(node, low)
    }
    return [container, container.childNodes.length]
  }
  const head = doc.createRange(), tail = doc.createRange()
  head.selectNodeContents(container); head.setEnd(...boundary(lines[3].top))
  tail.selectNodeContents(container); tail.setStart(...boundary(lines.at(-3).top))
  return { head: head.cloneContents(), tail: tail.cloneContents() }
}
