import { useLayoutEffect, useRef } from 'react'
import { publicationPreview } from '../domain/publicationPreview.js'
import ReadonlyDocument from './ReadonlyDocument.js'

export default function PublicationPreview({ snapshot, compact = false }) {
  const measurement = useRef(null), preview = useRef(null)
  useLayoutEffect(() => {
    let live = true
    const measure = () => {
      if (!live) return
      const { head, tail, truncated } = publicationPreview(measurement.current, { compact })
      if (tail) {
        const ellipsis = document.createElement('div')
        ellipsis.className = 'owner-publication-ellipsis'
        ellipsis.textContent = '…'
        preview.current.replaceChildren(head, ellipsis, tail)
      } else {
        preview.current.replaceChildren(...head.childNodes)
        if (truncated) {
          const ellipsis = document.createElement('span')
          ellipsis.className = 'owner-publication-ellipsis'
          ellipsis.textContent = '…'
          const target = preview.current.querySelector('.readonly-document') ?? preview.current
          const last = target.lastElementChild
          const ellipsisHost = last?.tagName === 'P' ? last : target
          ellipsisHost.append(ellipsis)
        }
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(measurement.current)
    window.addEventListener('resize', measure)
    document.fonts?.ready.then(measure)
    document.fonts?.addEventListener('loadingdone', measure)
    return () => {
      live = false; observer.disconnect()
      window.removeEventListener('resize', measure)
      document.fonts?.removeEventListener('loadingdone', measure)
    }
  }, [snapshot, compact])
  return <div className="owner-publication-text owner-publication-preview-wrap">
    <div className="owner-publication-measurement" ref={measurement} aria-hidden="true" inert>
      <ReadonlyDocument record={snapshot} />
    </div>
    <div className="owner-publication-preview" ref={preview} />
  </div>
}
