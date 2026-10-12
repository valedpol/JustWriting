import { Mapping, Step } from '@tiptap/pm/transform'

// Only session history owns these receipts. Publication snapshots and persisted
// anchors do not contain an editor Undo stack. Inverted steps share the receipt.
export class PublicationTextStep extends Step {
  constructor(textStep, id = crypto.randomUUID(), inverse = false, receipt = { entries: new Map() }) {
    super()
    this.textStep = textStep
    this.id = id
    this.inverse = inverse
    this.receipt = receipt
  }
  apply(doc) { return this.textStep.apply(doc) }
  getMap() { return this.textStep.getMap() }
  invert(doc) { return new PublicationTextStep(this.textStep.invert(doc), this.id, !this.inverse, this.receipt) }
  map(mapping) {
    const textStep = this.textStep.map(mapping)
    if (!textStep) return null
    const afterMapping = new Mapping()
    afterMapping.appendMap(this.textStep.getMap().invert())
    const offset = afterMapping.maps.length
    for (let i = mapping.from; i < mapping.to; i++) {
      const mirror = mapping.getMirror(i)
      afterMapping.appendMap(mapping.maps[i], mirror >= mapping.from && mirror < i ? offset + mirror - mapping.from : undefined)
    }
    afterMapping.appendMap(textStep.getMap(), 0)
    const mappedRange = (range, map) => range ? { from: map.map(range.from, 1), to: map.map(range.to, -1) } : null
    const entries = new Map()
    for (const [id, pair] of this.receipt.entries) entries.set(id, {
      before: mappedRange(pair.before, this.inverse ? afterMapping : mapping),
      after: mappedRange(pair.after, this.inverse ? mapping : afterMapping),
    })
    return new PublicationTextStep(textStep, this.id, this.inverse, { entries })
  }
  toJSON() { return { stepType: 'jwPublicationText', id: this.id, inverse: this.inverse, textStep: this.textStep.toJSON() } }
  static fromJSON(schema, value) { return new PublicationTextStep(Step.fromJSON(schema, value.textStep), value.id, value.inverse) }
}
Step.jsonID('jwPublicationText', PublicationTextStep)
