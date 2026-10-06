import { keymap } from '@tiptap/pm/keymap'
import { baseKeymap, chainCommands, exitCode } from '@tiptap/pm/commands'
import { undo, redo } from '@tiptap/pm/history'
import { createDayEditorState } from './dayOperations.js'
import { toggleFirstTextMark } from './formatting.js'
import { rapidRulePlugin } from './horizontalRule.js'

export function createWritingState(record) {
  const state = createDayEditorState(record)
  const hardBreak = (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(state.schema.nodes.hardBreak.create()).scrollIntoView())
    return true
  }
  return state.reconfigure({ plugins: [...state.plugins, rapidRulePlugin(), keymap({
    'Mod-b': toggleFirstTextMark(state.schema.marks.bold), 'Mod-i': toggleFirstTextMark(state.schema.marks.italic),
    'Mod-u': toggleFirstTextMark(state.schema.marks.underline), 'Mod-z': undo, 'Shift-Mod-z': redo,
    'Mod-y': redo, 'Shift-Enter': chainCommands(exitCode, hardBreak),
  }), keymap(baseKeymap)] })
}
