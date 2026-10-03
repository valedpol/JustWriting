import DOMPurify from 'dompurify'

// First sanitize external HTML, then normalize its structure to the v1 schema.
export function cleanPaste(html) {
  const safe = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['hr', 'p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'span', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'table', 'tbody', 'tr', 'td', 'th'],
    ALLOWED_ATTR: ['style'],
  })
  const document = new DOMParser().parseFromString(safe, 'text/html')
  for (const element of [...document.body.querySelectorAll('*')]) {
    const style = element.style
    const marks = []
    if (style.fontWeight === 'bold' || Number(style.fontWeight) >= 600) marks.push('strong')
    if (style.fontStyle === 'italic') marks.push('em')
    if ((style.textDecoration + ' ' + style.textDecorationLine).includes('underline')) marks.push('u')
    for (const name of element.getAttributeNames()) element.removeAttribute(name)
    for (const tag of marks) {
      const wrapper = document.createElement(tag)
      wrapper.append(...element.childNodes)
      element.append(wrapper)
    }
    if (['DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR'].includes(element.tagName)) {
      const paragraph = document.createElement('p')
      paragraph.append(...element.childNodes)
      element.replaceWith(paragraph)
    }
    if (['TD', 'TH'].includes(element.tagName)) element.append(document.createElement('br'))
  }
  return DOMPurify.sanitize(document.body.innerHTML, {
    ALLOWED_TAGS: ['hr', 'p', 'br', 'strong', 'b', 'em', 'i', 'u'],
    ALLOWED_ATTR: [],
  })
}
