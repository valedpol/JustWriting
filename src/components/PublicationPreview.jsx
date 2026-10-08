import { useLayoutEffect, useRef } from 'react'
import { publicationPreview } from '../domain/publicationPreview.js'
import ReadonlyDocument from './ReadonlyDocument.js'

export default function PublicationPreview({ snapshot }) {
  const measurement = useRef(null), preview = useRef(null)
  useLayoutEffect(() => {
    let live = true
    const measure = () => {
      if (!live) return
      const { head, tail } = publicationPreview(measurement.current)
      if (tail) {
        const ellipsis = document.createElement('div')
        ellipsis.className = 'owner-publication-ellipsis'
        ellipsis.textContent = '…'
        preview.current.replaceChildren(head, ellipsis, tail)
      } else preview.current.replaceChildren(...head.childNodes)
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
  }, [snapshot])
  return <div className="owner-publication-text owner-publication-preview-wrap">
    <div className="owner-publication-measurement" ref={measurement} aria-hidden="true" inert>
      <ReadonlyDocument record={snapshot} />
    </div>
    <div className="owner-publication-preview" ref={preview} />
  </div>
}
