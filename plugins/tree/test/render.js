// Tiny dependency-free renderer for client.js components: hooks are stubbed (useState returns its
// initial value, effects do not run), elements render to an HTML string.
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useState: init => [typeof init === 'function' ? init() : init, () => {}],
  useEffect() {},
  useCallback: fn => fn,
}
const attr = (k, v) => {
  if (v === undefined || v === null || v === false || typeof v === 'function' || k === 'key') return ''
  if (k === 'className') k = 'class'
  if (k === 'style' && typeof v === 'object') v = Object.entries(v).map(([a, b]) => `${a.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}:${b}`).join(';')
  return v === true ? ` ${k}` : ` ${k}="${esc(v)}"`
}
export function renderToString(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (Array.isArray(node)) return node.map(renderToString).join('')
  if (typeof node !== 'object') return esc(node)
  if (typeof node.type === 'function') return renderToString(node.type({ ...node.props, children: node.children }))
  const attrs = Object.entries(node.props).map(([k, v]) => attr(k, k === 'aria-expanded' && typeof v === 'boolean' ? String(v) : v)).join('')
  return `<${node.type}${attrs}>${node.children.map(renderToString).join('')}</${node.type}>`
}
/** Find elements (depth-first, components expanded) matching a predicate. */
export function findAll(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const n of node) findAll(n, pred, out); return out }
  if (typeof node.type === 'function') return findAll(node.type({ ...node.props, children: node.children }), pred, out)
  if (pred(node)) out.push(node)
  for (const c of node.children) findAll(c, pred, out)
  return out
}
