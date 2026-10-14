// Tree model over per-bot fields (all sync, namespaced to 'flybot-tree'). Fields used:
//   parent:   parent bot id (absent/null for the root)    (the tree edge)
//   treeRole: role description; 'root' marks the root      (marks a bot as a tree member)
// The root is ds-bot's Main Bot (Chief, BotView.isMain), adopted with treeRole 'root'. A separate
// root bot is created only when the team has no Main Bot at all.
import { checkCreate } from './limits.js'
import { systemPrompt, withTreeBlock, hasTreeBlock } from './prompt.js'

export const TREE_KEYS = new Set(['parent', 'treeRole'])
export const ROOT_ROLE = 'root'
const LEGACY_ROOT_ROLE = 'Top-level coordinator for everything.'
const ROOT_LABEL = 'Main bot and root of the tree'

export function createTree(fb, { limits, rootName = 'Root', rootBotId } = {}) {
  const listeners = new Set()

  function snapshot() {
    const nodes = {}
    for (const b of fb.listBots()) {
      const role = fb.getField(b.id, 'treeRole')
      const parent = fb.getField(b.id, 'parent')
      if (role === undefined && parent === undefined) continue
      nodes[b.id] = { id: b.id, name: b.name, role: role === ROOT_ROLE ? ROOT_LABEL : (role ?? ''), parent: parent ?? null, root: role === ROOT_ROLE }
    }
    return nodes
  }
  const childrenOf = (nodes, id) => Object.values(nodes).filter(n => n.parent === id)
  const depthOf = (nodes, id) => { let d = 0; for (let x = id, seen = new Set(); x && nodes[x] && !seen.has(x); x = nodes[x].parent) { seen.add(x); d++ } return d }
  const traceOf = (nodes, id) => { const p = []; for (let x = id; x && nodes[x] && p.length < 64; x = nodes[x].parent) p.unshift(nodes[x].name); return p.join(' → ') }

  const promptFor = (id, nodes = snapshot()) => {
    const n = nodes[id]
    return n && systemPrompt({ name: n.name, role: n.role, trace: traceOf(nodes, id), children: childrenOf(nodes, id), root: n.root })
  }
  // Prompt injection: only the tree's marked block is replaced; other text (e.g. Chief's own) stays.
  const writeBlock = (id, block) => {
    const current = fb.getSystemPrompt(id)
    const next = withTreeBlock(current, block)
    if (next !== String(current ?? '').trim()) fb.setSystemPrompt(id, next)
  }
  const refreshPrompt = (id, nodes = snapshot()) => { if (nodes[id]) writeBlock(id, promptFor(id, nodes)) }

  // ---------------------------------------------------------------- root
  /** The Main Bot (Chief): config.rootBotId if it exists, else the Main Bot named 'Chief', else the first Main Bot. */
  function findChief() {
    const bots = fb.listBots()
    if (rootBotId) return bots.find(b => b.id === rootBotId)
    const mains = bots.filter(b => b.isMain === true)
    return mains.find(b => b.name === 'Chief') ?? mains[0]
  }
  const isLegacyRoot = (b, chiefId) => b.id !== chiefId && b.isMain !== true && fb.getField(b.id, 'parent') == null &&
    fb.getField(b.id, 'treeRole') !== undefined && (b.name === rootName || fb.getField(b.id, 'treeRole') === LEGACY_ROOT_ROLE)

  /** Earlier installs auto-created a separate 'Root': move its children to Chief, clear its tree fields and block. Never deletes it. Idempotent. */
  function migrateLegacyRoots(chiefId) {
    const moved = []
    for (const b of fb.listBots()) {
      if (!isLegacyRoot(b, chiefId)) continue
      for (const c of fb.listBots()) if (fb.getField(c.id, 'parent') === b.id) { fb.setField(c.id, 'parent', chiefId); moved.push(c.id) }
      fb.setField(b.id, 'parent', null)
      fb.setField(b.id, 'treeRole', null)
      const prompt = fb.getSystemPrompt(b.id)
      if (hasTreeBlock(prompt)) writeBlock(b.id, '')
      else if (/a bot in a recursive bot tree/.test(prompt)) fb.setSystemPrompt(b.id, '') // pre-block installs: the whole prompt was ours
    }
    return moved
  }

  /** Adopts Chief as the root (treeRole 'root', no bot created). Returns its id, or undefined while the team is not loaded. */
  function adoptChief() {
    const chief = findChief()
    if (!chief) return undefined
    if (fb.getField(chief.id, 'parent') !== undefined) fb.setField(chief.id, 'parent', null)
    if (fb.getField(chief.id, 'treeRole') !== ROOT_ROLE) fb.setField(chief.id, 'treeRole', ROOT_ROLE)
    migrateLegacyRoots(chief.id)
    const nodes = snapshot()
    for (const id of [chief.id, ...childrenOf(nodes, chief.id).map(c => c.id)]) refreshPrompt(id, nodes)
    return chief.id
  }

  let rootTask
  /**
   * Idempotent; concurrent calls share one creation. Adopts Chief; creates a root bot only when the
   * team has bots but no Main Bot. With no bots listed yet (team not loaded) it resolves undefined.
   */
  function ensureRoot({ create = true } = {}) {
    const adopted = adoptChief()
    if (adopted) return Promise.resolve(adopted)
    if (rootBotId) return Promise.resolve(undefined) // configured root not there (yet)
    const existing = Object.values(snapshot()).find(n => n.root || n.parent === null)
    if (existing) return Promise.resolve(existing.id)
    if (!create || fb.listBots().length === 0) return Promise.resolve(undefined)
    rootTask ??= createRoot().finally(() => { rootTask = undefined })
    return rootTask
  }
  async function createRoot() {
    const prompt = systemPrompt({ name: rootName, role: ROOT_LABEL, trace: rootName, children: [], root: true })
    return fb.createBot({ name: rootName, systemPrompt: withTreeBlock('', prompt), fields: { parent: null, treeRole: ROOT_ROLE } })
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
    const id = await fb.createBot({ name: clean, systemPrompt: withTreeBlock('', prompt), fields: { parent: parentId, treeRole: role } })
    refreshPrompt(parentId) // the parent now lists the new child
    return { id, name: clean, depth: depthOf(nodes, parentId) + 1 }
  }

  // A tree member has treeRole (or parent; the root's parent is null/absent).
  const isMember = id => typeof id === 'string' && (fb.getField(id, 'treeRole') !== undefined || fb.getField(id, 'parent') !== undefined)
  const parentOf = id => fb.getField(id, 'parent') ?? null
  const isRoot = id => isMember(id) && (fb.getField(id, 'treeRole') === ROOT_ROLE || fb.getField(id, 'parent') == null)
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

  return { limits, snapshot, childrenOf, depthOf, traceOf, ensureRoot, adoptChief, findChief, migrateLegacyRoots, promptFor, createChild, isMember, isRoot, isTreeEdge, onFieldChange, onBotRemoved, subscribe }
}
