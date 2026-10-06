import { Fragment } from '@tiptap/pm/model'
import { AddMarkStep, RemoveMarkStep } from '@tiptap/pm/transform'
import { SemanticStep } from './semanticHistory.js'
import { formattingMarks } from './formatting.js'
import { documentToContent } from './document.js'
import { parseSemanticMarkup } from './semanticSnapshot.js'

const sameMarkup = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const denied = () => { throw new Error('Текст архива доступен только для чтения. Изменение символов или структуры запрещено.') }

// Fragment merges adjacent text nodes split solely by formatting marks.
function withoutFormatting(node) {
  if (node.isText) return node.mark(node.marks.filter(mark => !formattingMarks.includes(mark.type.name)))
  const children = []
  node.forEach(child => children.push(withoutFormatting(child)))
  return node.copy(Fragment.fromArray(children)).mark(node.marks.filter(mark => !formattingMarks.includes(mark.type.name)))
}

export function assertSameArchiveText(before, after) {
  if (!withoutFormatting(before).eq(withoutFormatting(after)) ||
    documentToContent(before.toJSON()) !== documentToContent(after.toJSON())) denied()
}

export function assertArchiveTransaction(tr, initialMarkup) {
  let doc = tr.before, markup = structuredClone(initialMarkup)
  for (const wrapped of tr.steps) {
    const semantic = wrapped.constructor === SemanticStep
    const step = semantic ? wrapped.textStep : wrapped
    if (semantic) {
      if (!sameMarkup(wrapped.before, markup)) denied()
      parseSemanticMarkup(wrapped.after, doc.content.size)
      if (step && !sameMarkup(wrapped.before, wrapped.after)) denied()
    }
    if (step) {
      if (![AddMarkStep, RemoveMarkStep].includes(step.constructor) || !formattingMarks.includes(step.mark.type.name) ||
        Object.keys(step.mark.attrs).length || step.mark.type !== tr.before.type.schema.marks[step.mark.type.name]) denied()
    } else if (!semantic) denied()
    const result = wrapped.apply(doc)
    if (result.failed) denied()
    assertSameArchiveText(doc, result.doc)
    doc = result.doc
    if (semantic) markup = wrapped.after
  }
  if (!doc.eq(tr.doc)) denied()
  assertSameArchiveText(tr.before, doc)
  return structuredClone(markup)
}

// Recreate mark changes on an existing state, preserving its text-edit history.
export function applyArchiveFormatting(tr, target) {
  assertSameArchiveText(tr.doc, target)
  if (tr.doc.eq(target)) return tr
  const runs = []
  target.descendants((node, pos) => {
    if (node.isInline) runs.push({ from: pos, to: pos + node.nodeSize, marks: node.marks })
  })
  for (const name of formattingMarks) {
    const type = tr.doc.type.schema.marks[name]
    tr.removeMark(0, tr.doc.content.size, type)
    for (const run of runs) if (type.isInSet(run.marks)) tr.addMark(run.from, run.to, type.create())
  }
  if (!tr.doc.eq(target)) denied()
  return tr
}
