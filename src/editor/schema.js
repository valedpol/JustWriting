import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Underline from '@tiptap/extension-underline'
import { UndoRedo } from '@tiptap/extensions'
import { HorizontalRule } from './horizontalRule.js'

export const extensions = [Document, Paragraph, Text, HardBreak, Bold, Italic, Underline, UndoRedo, HorizontalRule]
