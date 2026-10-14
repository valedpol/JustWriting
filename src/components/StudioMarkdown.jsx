import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export default function StudioMarkdown({ content, label, className = 'studio-content' }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(content, { async: false, gfm: false }), {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'hr', 'br', 'a'],
    ALLOWED_ATTR: ['href', 'title', 'start'],
  }), [content])
  return <article className={className} aria-label={label} dangerouslySetInnerHTML={{ __html: html }} />
}
