// EditorView.focus deliberately does not focus a non-editable root. An archive
// still needs native selection ownership when a semantic label selects text.
export function focusView(view) {
  if (!view) return
  if (!view.editable) {
    view.dom.focus({ preventScroll: true })
    const selection = view.dom.ownerDocument.getSelection()
    if (selection && !view.dom.contains(selection.anchorNode)) selection.collapse(view.dom, 0)
  }
  view.focus()
}
