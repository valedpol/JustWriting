import { Node } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'

// Prototype timing, not a persisted product setting.
export const DASH_INTERVAL_MS = 400

export function rapidRulePlugin(now = () => performance.now()) {
  let run = null
  let inserting = false
  const reset = () => { run = null; return false }
  return new Plugin({
    state: {
      init: () => null,
      apply(transaction) {
        if (!inserting && (transaction.docChanged || transaction.selectionSet)) reset()
        return null
      },
    },
    props: {
      handleDOMEvents: {
        blur: reset, pointerdown: reset, paste: reset, compositionstart: reset,
        keydown: (_view, event) => event.key === '-' && !event.metaKey && !event.ctrlKey && !event.altKey ? false : reset(),
      },
      handleTextInput(view, from, to, text) {
        const { $from } = view.state.selection
        const timestamp = now()
        if (view.composing || text !== '-' || from !== to || !$from.parent.isTextblock ||
          $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return reset()
        const prefix = $from.parent.textContent
        const start = $from.before()
        if (prefix === '') run = { start, count: 0, timestamp }
        if (!run || run.start !== start || prefix !== '-'.repeat(run.count) ||
          timestamp - run.timestamp > DASH_INTERVAL_MS) return reset()
        run.count += 1
        run.timestamp = timestamp
        const convert = run.count === 4
        inserting = true
        try { view.dispatch(view.state.tr.insertText('-', from, to)) }
        finally { inserting = false }
        if (convert) {
          reset()
          const { state } = view
          const paragraph = state.doc.nodeAt(start)
          const tr = closeHistory(state.tr).replaceWith(start, start + paragraph.nodeSize, [
            state.schema.nodes.horizontalRule.create(), state.schema.nodes.paragraph.create(),
          ])
          tr.setSelection(TextSelection.create(tr.doc, start + 2))
          view.dispatch(tr.scrollIntoView())
          // Further typing must not merge with the conversion in Undo history.
          view.dispatch(closeHistory(view.state.tr))
        }
        return true
      },
    },
  })
}

export const HorizontalRule = Node.create({
  name: 'horizontalRule',
  group: 'block',
  atom: true,
  parseHTML: () => [{ tag: 'hr' }],
  renderHTML: () => ['hr'],
  addProseMirrorPlugins: () => [rapidRulePlugin()],
})
