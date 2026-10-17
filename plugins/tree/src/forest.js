// forestOf(bots): the tree as nested nodes, synchronously, from bot records that carry
// fields['flybot-tree'] (host bot.list() views, or the browser roster's bots). Same code runs in the
// browser (client.js inlines an identical copy; a test keeps them in sync).
//   node = { id, name, role, root, createdAt, children: node[] }
//   - members: bots with treeRole or parent set, not retired
//   - root: treeRole === 'root'; role text: 'Main bot · root of the tree' for the root
//   - top level: roots first, then members whose parent is missing (orphans); siblings by createdAt
//     (records without createdAt, e.g. host BotViews, keep their list order), then name
//   - createdAt is the record's number, or null when absent
export function forestOf(bots) {
  const nodes = new Map()
  let index = 0
  for (const b of bots ?? []) {
    const at = index++
    const own = b?.fields?.['flybot-tree'] ?? {}
    if (own.retired === true || (own.parent === undefined && own.treeRole === undefined)) continue
    nodes.set(b.id, { id: b.id, name: b.name, role: own.treeRole === 'root' ? 'Main bot · root of the tree' : (own.treeRole ?? ''), root: own.treeRole === 'root', createdAt: typeof b.createdAt === 'number' ? b.createdAt : null, key: typeof b.createdAt === 'number' ? b.createdAt : at, parent: own.parent ?? null, children: [] })
  }
  const top = []
  for (const n of nodes.values()) {
    const p = n.parent !== null && n.parent !== n.id ? nodes.get(n.parent) : undefined
    if (p) p.children.push(n); else top.push(n)
  }
  const order = (a, b) => (a.key - b.key) || String(a.name).localeCompare(String(b.name))
  const seen = new Set()
  const finish = n => {
    if (seen.has(n.id)) return null // cycle guard
    seen.add(n.id)
    const { parent: _parent, key: _key, ...rest } = n
    return { ...rest, children: n.children.sort(order).map(finish).filter(Boolean) }
  }
  top.sort((a, b) => (Number(b.root) - Number(a.root)) || order(a, b))
  return top.map(finish).filter(Boolean)
}
