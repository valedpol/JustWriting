import { useEffect } from 'react'
import { routeWorkspaceWheel } from '../domain/workspaceScroll.js'

export function useWorkspaceScroll(workspaceRef, section) {
  useEffect(() => {
    const selector = section === 'archive' ? '.archive-scroll' : section === 'settings' ? '.settings-content' : section === 'research' ? '.research-content' : section === 'today' ? '.writing-scroll' : null
    const workspace = workspaceRef.current
    if (!workspace || !selector) return
    const onWheel = (event) => {
      const publications = section === 'archive' ? workspace.querySelector('.owner-publications') : null
      routeWorkspaceWheel(event, workspace, publications?.querySelector('.owner-publications-scroll') ?? workspace.querySelector(selector))
    }
    // Native listener permits preventDefault; React wheel listeners may be passive.
    workspace.addEventListener('wheel', onWheel, { passive: false })
    return () => workspace.removeEventListener('wheel', onWheel)
  }, [workspaceRef, section])
}
