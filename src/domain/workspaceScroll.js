// Extend the existing scroller's wheel surface without changing its dimensions.
export function routeWorkspaceWheel(event, workspace, scroller) {
  if (!scroller || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY) return
  const target = event.target
  if (!workspace.contains(target) || target.closest?.('.left-sidebar')) return
  // Let the browser handle scrolling over the actual scroll container.
  if (scroller.contains(target)) return
  if (!event.cancelable) return
  event.preventDefault()
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1
  scroller.scrollTop += event.deltaY * unit
}
