// Tree model over per-bot fields (all sync). Fields used:
//   parent: parent bot id, or null for the root    (the tree edge)
//   treeRole: role description                      (marks a bot as a tree member)
// The root is the tree bot whose `parent` is null.
import { checkCreate } from './limits.js'
import { systemPrompt } from './prompt.js'

export const TREE_KEYS = new Set(['parent', 'treeRole'])

export function createTree(fb, { limits, rootName = 'Root' } = {}) {
  const listeners = new Set()

  function snapshot() {
    const nodes = {}
    for (const b of fb.listBots()) {
      const role = fb.getField(b.id, 'treeRole')
      const parent = fb.getField(b.id, 'parent')
      if (role === undefined && parent === undefined) continue
      nodes[b.id] = { id: b.id, name: b.name, role: role ?? '', parent: parent ?? null }
    }
    return nodes
  }
  const childrenOf = (nodes, id) => Object.values(nodes).filter(n => n.parent === id)
  const depthOf = (nodes, id) => { let d = 0; for (let x = id, seen = new Set(); x && nodes[x] && !seen.has(x); x = nodes[x].parent) { seen.add(x); d++ } return d }
  const traceOf = (nodes, id) => { const p = []; for (let x = id; x && nodes[x] && p.length < 64; x = nodes[x].parent) p.unshift(nodes[x].name); return p.join(' → ') }

  const promptFor = (id, nodes = snapshot()) => {
    const n = nodes[id]
    return n && systemPrompt({ name: n.name, role: n.role, trace: traceOf(nodes, id), children: childrenOf(nodes, id) })
  }
  const refreshPrompt = (id, nodes = snapshot()) => { if (nodes[id]) fb.setSystemPrompt(id, promptFor(id, nodes)) }

  async function ensureRoot() {
    const root = Object.values(snapshot()).find(n => n.parent === null)
    if (root) return root.id
    const role = 'Top-level coordinator for everything.'
    const id = await fb.createBot({ name: rootName, systemPrompt: systemPrompt({ name: rootName, role, trace: rootName, children: [] }), fields: { parent: null, treeRole: role } })
    return id
  }

  /** Creates a child under parentId (the CALLER; the tool never takes a parent argument). */
  async function createChild(parentId, name, roleDescription) {
    const nodes = snapshot()
    const parent = nodes[parentId]
    if (!parent) throw new Error('this bot is not part of the tree')
    const clean = String(name ?? '').trim()
    const role = String(roleDescription ?? '').trim()
    const reason = checkCreate({ parentName: parent.name, parentDepth: depthOf(nodes, parentId), siblings: childrenOf(nodes, parentId), name: clean, limits })
    if (reason) throw new Error(reason)
    const prompt = systemPrompt({ name: clean, role, trace: `${traceOf(nodes, parentId)} → ${clean}`, children: [] })
    const id = await fb.createBot({ name: clean, systemPrompt: prompt, fields: { parent: parentId, treeRole: role } })
    refreshPrompt(parentId) // the parent now lists the new child
    return { id, name: clean, depth: depthOf(nodes, parentId) + 1 }
  }

  // A tree member has treeRole (or parent; the root's parent may be null/absent).
  const isMember = id => typeof id === 'string' && (fb.getField(id, 'treeRole') !== undefined || fb.getField(id, 'parent') !== undefined)
  const parentOf = id => fb.getField(id, 'parent') ?? null
  const isRoot = id => isMember(id) && fb.getField(id, 'parent') == null
  function isTreeEdge(from, to) {
    const fromIn = isMember(from), toIn = isMember(to)
    return { fromIn, toIn, inTree: fromIn && toIn, allowed: fromIn && toIn && (parentOf(to) === from || parentOf(from) === to) }
  }

  const emit = change => { for (const fn of listeners) fn(change) }
  function onFieldChange(change) {
    if (!change || !TREE_KEYS.has(change.key)) return
    emit(change)
  }
  /** After deletion: the removed bot's children re-attach to its parent (from the event's last record). */
  function onBotRemoved({ botId, parent }) {
    if (parent === undefined) return // not a tree bot
    const nodes = snapshot()
    const up = parent ?? null
    for (const child of childrenOf(nodes, botId)) fb.setField(child.id, 'parent', up)
    if (up) refreshPrompt(up)
    emit({ botId, key: 'removed' })
  }
  const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }

  return { limits, snapshot, childrenOf, depthOf, traceOf, ensureRoot, promptFor, createChild, isMember, isRoot, isTreeEdge, onFieldChange, onBotRemoved, subscribe }
}
