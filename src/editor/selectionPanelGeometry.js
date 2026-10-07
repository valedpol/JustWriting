// Prefer the usual inset, but use the available gap above visible text when
// it can contain the complete toolbar and both visual clearances.
export function stickySelectionPanelTop(boundaryBottom, firstVisibleTop, panelHeight) {
  const preferred = boundaryBottom + 8
  const aboveText = firstVisibleTop - panelHeight - 4
  return Number.isFinite(aboveText) && aboveText >= boundaryBottom + 2
    ? Math.min(preferred, aboveText)
    : preferred
}
