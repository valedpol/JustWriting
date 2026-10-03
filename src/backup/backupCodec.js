// A tagged graph, not JSON serialization of IndexedDB values. Unsupported
// structured-clone types fail closed rather than silently losing information.
export async function encode(value) {
  const nodes = [], seen = new Map()
  async function visit(v) {
    if (v === undefined) return ['undefined']
    if (typeof v === 'bigint') return ['bigint', String(v)]
    if (typeof v === 'number') return ['number', Object.is(v, -0) ? '-0' : String(v)]
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return ['primitive', v]
    if (typeof v !== 'object') throw new Error('Unsupported backup value')
    if (seen.has(v)) return ['ref', seen.get(v)]
    const id = nodes.length; seen.set(v, id); nodes.push(null)
    let node
    if (v instanceof Date) node = ['date', String(v.getTime())]
    else if (v instanceof RegExp) node = ['regexp', v.source, v.flags]
    else if (v instanceof ArrayBuffer) node = ['buffer', Array.from(new Uint8Array(v))]
    else if (ArrayBuffer.isView(v)) node = ['view', v.constructor.name, await visit(v.buffer), v.byteOffset, v instanceof DataView ? v.byteLength : v.length]
    else if (typeof Blob !== 'undefined' && v instanceof Blob) {
      if (typeof File !== 'undefined' && v instanceof File) node = ['file', v.name, v.type, v.lastModified, Array.from(new Uint8Array(await v.arrayBuffer()))]
      else node = ['blob', v.type, Array.from(new Uint8Array(await v.arrayBuffer()))]
    } else if (v instanceof Map) {
      node = ['map', []]; for (const [k, item] of v) node[1].push([await visit(k), await visit(item)])
    } else if (v instanceof Set) {
      node = ['set', []]; for (const item of v) node[1].push(await visit(item))
    } else if (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) {
      node = [Array.isArray(v) ? 'array' : 'object', Array.isArray(v) ? v.length : null, []]
      for (const key of Object.keys(v).sort()) node[2].push([key, await visit(v[key])])
    } else throw new Error(`Unsupported backup type: ${v.constructor?.name}`)
    nodes[id] = node; return ['ref', id]
  }
  const root = await visit(value)
  return { root, nodes }
}

export const valueIdentity = async value => JSON.stringify(await encode(value))

export function decode(graph) {
  const cache = new Map()
  function read(token) {
    const [type, value] = token
    if (type === 'primitive') return value
    if (type === 'undefined') return undefined
    if (type === 'bigint') return BigInt(value)
    if (type === 'number') return Number(value)
    if (type !== 'ref' || !Number.isInteger(value) || !graph.nodes[value]) throw new Error('Invalid backup token')
    if (cache.has(value)) return cache.get(value)
    const n = graph.nodes[value]; let out
    switch (n[0]) {
      case 'object': out = {}; break
      case 'array': out = new Array(n[1]); break
      case 'map': out = new Map(); break
      case 'set': out = new Set(); break
      case 'date': out = new Date(Number(n[1])); break
      case 'regexp': out = new RegExp(n[1], n[2]); break
      case 'buffer': out = Uint8Array.from(n[1]).buffer; break
      case 'blob': out = new Blob([Uint8Array.from(n[2])], { type: n[1] }); break
      case 'file': out = new File([Uint8Array.from(n[4])], n[1], { type: n[2], lastModified: n[3] }); break
      case 'view': {
        const constructors = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView }
        if (!Object.hasOwn(constructors, n[1])) throw new Error('Invalid view')
        out = new constructors[n[1]](read(n[2]), n[3], n[4]); break
      }
      default: throw new Error('Invalid backup node')
    }
    cache.set(value, out)
    if (n[0] === 'object' || n[0] === 'array') for (const [k, v] of n[2]) Object.defineProperty(out, k, { value: read(v), enumerable: true, writable: true, configurable: true })
    if (n[0] === 'map') for (const [k, v] of n[1]) out.set(read(k), read(v))
    if (n[0] === 'set') for (const v of n[1]) out.add(read(v))
    return out
  }
  return read(graph.root)
}
