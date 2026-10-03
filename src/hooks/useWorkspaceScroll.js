import { useEffect } from 'react'
import { routeWorkspaceWheel } from '../domain/workspaceScroll.js'

export function useWorkspaceScroll(workspaceRef, section) {
  useEffect(() => {
    const selector = section === 'archive' ? '.archive-scroll' : section === 'settings' ? '.settings-content' : section === 'today' ? '.writing-scroll' : null
    const workspace = workspaceRef.current
    if (!workspace || !selector) return
    const onWheel = (event) => routeWorkspaceWheel(event, workspace, workspace.querySelector(selector))
    // Native listener permits preventDefault; React wheel listeners may be passive.
    workspace.addEventListener('wheel', onWheel, { passive: false })
    return () => workspace.removeEventListener('wheel', onWheel)
  }, [workspaceRef, section])
}
