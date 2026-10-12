import { archiveSearch } from '../domain/archiveSearch.js'
import { CONTENT_FORMAT, CONTENT_VERSION, documentToContent } from './document.js'
import { getSemanticMarkup } from './semanticHistory.js'

// A transient read projection of the open PM document, including unsaved input.
// Reuse archive search's literal matching, normalization, ordering and offsets.
export function currentDaySearch(state, query, textId = 'current-day') {
  query = query.trim()
  if (!query) return []
  const document = state.doc.toJSON()
  return archiveSearch([{ textId, document, content: documentToContent(document),
    contentFormat: CONTENT_FORMAT, contentVersion: CONTENT_VERSION,
    semanticMarkup: getSemanticMarkup(state) }], query).occurrences
}

// Scroll the actual match label/text, never the associated semantic range.
export function revealDaySearchMatch(element, scroller, metadataHost) {
  if (!element || !scroller) return
  const viewport = scroller.getBoundingClientRect()
  const writing = scroller.closest('.app-shell')
  const buffer = writing && !writing.classList.contains('screen-interface')
    ? parseFloat(getComputedStyle(writing).getPropertyValue('--text-buffer-end')) || 0 : 0
  const bounds = element.getBoundingClientRect()
  const rail = metadataHost?.contains(element) ? metadataHost.getBoundingClientRect() : viewport
  const top = Math.max(viewport.top + buffer, rail.top) + 8
  const bottom = Math.min(viewport.bottom, rail.bottom) - 8
  if (bounds.top < top) scroller.scrollTop += bounds.top - top
  else if (bounds.bottom > bottom) scroller.scrollTop += bounds.bottom - bottom
}
