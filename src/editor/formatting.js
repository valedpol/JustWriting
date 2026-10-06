import { closeHistory } from '@tiptap/pm/history'

export const formattingMarks = ['bold', 'italic', 'underline']

export function firstTextHasMark(state, markType) {
  let found = false, marked = false
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (found) return false
    if (node.isText && Math.max(pos, state.selection.from) < Math.min(pos + node.nodeSize, state.selection.to)) {
      found = true
      marked = Boolean(markType.isInSet(node.marks))
    }
  })
  return found ? marked : null
}

export function toggleFirstTextMark(markType) {
  return (state, dispatch) => {
    if (!formattingMarks.includes(markType.name)) return false
    if (state.selection.empty) {
      const cursor = state.selection.$cursor
      if (!cursor) return false
      if (dispatch) dispatch(markType.isInSet(state.storedMarks ?? cursor.marks())
        ? state.tr.removeStoredMark(markType) : state.tr.addStoredMark(markType.create()))
      return true
    }
    const marked = firstTextHasMark(state, markType)
    if (marked === null) return false
    if (dispatch) {
      const tr = closeHistory(state.tr)
      for (const { $from, $to } of state.selection.ranges) {
        if (marked) tr.removeMark($from.pos, $to.pos, markType)
        else tr.addMark($from.pos, $to.pos, markType.create())
      }
      dispatch(tr.setMeta('jwFormattingCommand', true))
    }
    return true
  }
}
