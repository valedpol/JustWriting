import { useLayoutEffect, useState } from 'react'

// Search and timer share the same floating slot in the right information area.
export function useWritingToolPosition(anchor, metadataHost, layoutKey) {
  const [position, setPosition] = useState(null)
  useLayoutEffect(() => {
    if (!metadataHost || !anchor.current) return
    const measure = () => {
      const area = metadataHost.getBoundingClientRect()
      const width = area.width * 0.65
      const icon = anchor.current.getBoundingClientRect()
      setPosition({ left: area.left + (area.width - width) / 2, top: icon.bottom + 10, width, iconCenter: icon.left + icon.width / 2 })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(metadataHost); observer.observe(anchor.current)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [anchor, metadataHost, layoutKey])
  return position
}
