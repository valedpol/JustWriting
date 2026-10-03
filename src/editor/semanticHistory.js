import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Mapping, Step, StepResult } from '@tiptap/pm/transform'
import { closeHistory } from '@tiptap/pm/history'
import { parseSemanticMarkup } from './semanticSnapshot.js'
import { mapSemanticMarkup, selectionMarkup, slashMarkup } from './semanticMarkup.js'

export const semanticMarkupKey = new PluginKey('jwSemanticMarkup')

// The document stays free of semantic attributes. ProseMirror history stores
// these reversible steps alongside its normal text/formatting operations.
export class SemanticStep extends Step {
  constructor(before, after, textStep = null) {
    super()
    this.before = structuredClone(before)
    this.after = structuredClone(after)
    this.textStep = textStep
  }

  apply(doc) {
    const result = this.textStep ? this.textStep.apply(doc) : StepResult.ok(doc)
    if (result.failed) return result
    try {
      parseSemanticMarkup(this.before, doc.content.size)
      parseSemanticMarkup(this.after, result.doc.content.size)
      return result
    } catch (error) { return StepResult.fail(error.message) }
  }

  getMap() { return this.textStep ? this.textStep.getMap() : super.getMap() }

  invert(doc) {
    return new SemanticStep(this.after, this.before, this.textStep?.invert(doc) ?? null)
  }

  map(mapping) {
    const textStep = this.textStep?.map(mapping) ?? null
    if (this.textStep && !textStep) return null
    // `before` and `after` belong to different documents. Map each in its own
    // coordinate space; mirrors preserve positions within inserted content.
    const afterMapping = new Mapping()
    if (this.textStep) afterMapping.appendMap(this.textStep.getMap().invert())
    if (mapping instanceof Mapping) {
      const offset = afterMapping.maps.length
      for (let i = mapping.from; i < mapping.to; i++) {
        const mirror = mapping.getMirror(i)
        afterMapping.appendMap(mapping.maps[i], mirror >= mapping.from && mirror < i ? offset + mirror - mapping.from : undefined)
      }
    } else afterMapping.appendMap(mapping)
    if (textStep) afterMapping.appendMap(textStep.getMap(), 0)
    return new SemanticStep(
      mapSemanticMarkup(this.before, mapping),
      mapSemanticMarkup(this.after, afterMapping), textStep,
    )
  }

  toJSON() {
    return { stepType: 'jwSemantic', before: this.before, after: this.after, textStep: this.textStep?.toJSON() ?? null }
  }

  static fromJSON(schema, json) {
    return new SemanticStep(json.before, json.after, json.textStep ? Step.fromJSON(schema, json.textStep) : null)
  }
}

Step.jsonID('jwSemantic', SemanticStep)

export function semanticHistoryPlugin(initialMarkup = []) {
  const initial = structuredClone(initialMarkup)
  return new Plugin({
    key: semanticMarkupKey,
    state: {
      init: (_config, state) => parseSemanticMarkup(initial, state.doc.content.size),
      apply: (tr, previous) => {
        let markup = previous
        for (const step of tr.steps) {
          if (!(step instanceof SemanticStep)) throw new Error('Транзакция должна пройти через trackSemanticTransaction')
          markup = step.after
        }
        return structuredClone(markup)
      },
    },
    // Fail closed rather than accepting a text change with a broken Undo pair.
    filterTransaction: (tr, state) => {
      let markup = semanticMarkupKey.getState(state)
      for (const step of tr.steps) {
        if (!(step instanceof SemanticStep) || JSON.stringify(step.before) !== JSON.stringify(markup)) return false
        // Semantic edits must participate in the same history as author text.
        if (!step.textStep && tr.getMeta('addToHistory') === false) return false
        markup = step.after
      }
      return true
    },
    appendTransaction: (transactions, _oldState, state) => transactions.some(tr => tr.getMeta('jwSemanticCommand'))
      ? closeHistory(state.tr) : null,
  })
}

export function getSemanticMarkup(state) {
  const markup = semanticMarkupKey.getState(state)
  if (!markup) throw new Error('Плагин смысловой разметки не подключён')
  return structuredClone(markup)
}

// Dispatch boundary for the later editor integration. Replays normal steps
// without altering the incoming transaction, its selection or its metadata.
// Undo/Redo already contain SemanticStep and can be dispatched directly.
export function trackSemanticTransaction(state, source, { scrollIntoView = true } = {}) {
  if (!source.before.eq(state.doc)) throw new Error('Устаревшая редакторская транзакция')
  let markup = getSemanticMarkup(state)
  const target = state.tr
  for (const step of source.steps) {
    if (step instanceof SemanticStep && JSON.stringify(step.before) !== JSON.stringify(markup)) {
      throw new Error('Устаревшая смысловая разметка транзакции')
    }
    const tracked = step instanceof SemanticStep ? step : new SemanticStep(markup, mapSemanticMarkup(markup, step.getMap(), target.doc), step)
    target.step(tracked)
    markup = tracked.after
  }
  if (source.selectionSet) target.setSelection(source.selection.getBookmark().resolve(target.doc))
  if (source.storedMarksSet) target.setStoredMarks(source.storedMarks)
  // ProseMirror exposes no metadata iterator; isolate the metadata copy here.
  for (const key of Object.keys(source.meta)) target.setMeta(key, source.getMeta(key))
  target.setTime(source.time)
  if (scrollIntoView && source.scrolledIntoView) target.scrollIntoView()
  return target
}

function changeMarkup(state, source, change) {
  const tr = trackSemanticTransaction(state, source)
  const before = tr.steps.length ? tr.steps.at(-1).after : getSemanticMarkup(state)
  const after = parseSemanticMarkup(change(structuredClone(before), tr.doc), tr.doc.content.size)
  if (JSON.stringify(before) === JSON.stringify(after)) return tr
  const storedMarks = tr.storedMarks ?? state.storedMarks
  tr.step(new SemanticStep(before, after))
  if (storedMarks) tr.setStoredMarks(storedMarks)
  // A semantic command is one Undo event, including any slash deletion.
  return closeHistory(tr).setMeta('jwSemanticCommand', true)
}

export function assignSelectionMarkup(state, attributes) {
  const item = selectionMarkup(state.doc, state.selection, attributes)
  return changeMarkup(state, state.tr, markup => [...markup, item])
}

// Call only after explicit confirmation. Ordinary slash input never calls this.
export function confirmSlashMarkup(state, from, attributes) {
  if (!Number.isInteger(from) || from < 0 || from >= state.doc.content.size || state.doc.textBetween(from, from + 1) !== '/') {
    throw new Error('В указанной позиции нет символа /')
  }
  return changeMarkup(state, state.tr.delete(from, from + 1), (markup, doc) => [
    ...markup, slashMarkup(doc, from, attributes),
  ])
}

// The user supplies the second boundary; no paragraph/rule/day heuristics.
export function setSemanticRange(state, id, range) {
  if (!range) throw new Error('Укажите смысловой диапазон')
  return changeMarkup(state, state.tr, markup => {
    if (!markup.some(item => item.id === id)) throw new Error('Смысловая разметка не найдена')
    return markup.map(item => item.id === id ? { ...item, range } : item)
  })
}

export function removeSemanticMarkup(state, id) {
  return changeMarkup(state, state.tr, markup => {
    if (!markup.some(item => item.id === id)) throw new Error('Смысловая разметка не найдена')
    return markup.filter(item => item.id !== id)
  })
}
