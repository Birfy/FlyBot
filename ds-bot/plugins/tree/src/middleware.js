// bot.send middleware for tree Bots: a tree Bot may message only its parent and direct children.
// - Remote targets (msg.target.remote === true, else bot.isRemote(to)) are never tree members:
//   no opinion (undefined), left to social; their fields are not read.
// - A non-root tree Bot sending to a LOCAL Bot outside the tree is denied; the root (Chief, the
//   user's main bot) may message any local bot.
// - A local non-tree sender may reach only the tree root; other tree nodes are denied.
// - Remote senders and non-tree -> non-tree traffic are not the tree's call: undefined.
// - Allowed edges: undefined, or allow + bypass:['social'] when config.bypassSocial === true.
const DENY_EDGE = 'tree: a bot may message only its parent and its direct children'
const DENY_INTO = 'tree: bots outside the tree may message only the tree root'
const DENY_OUTSIDE = 'tree: a tree bot may not message local bots outside the tree'

export function treeSendMiddleware(tree, { bypassSocial = false, isRemote = () => false } = {}) {
  return function treeSend(msg) {
    const from = msg?.from
    const to = msg?.target && msg.target.remote === false ? msg.target.id : msg?.to ?? msg?.target?.id
    if (!from || !to) return undefined
    if (msg.target?.remote === true || isRemote(to)) return undefined
    if (typeof from !== 'string' || isRemote(from)) return undefined
    const { fromIn, toIn, allowed } = tree.isTreeEdge(from, to)
    if (!fromIn) {
      if (!toIn) return undefined // non-tree traffic: not the tree's call
      return tree.isRoot(to) ? undefined : { action: 'deny', reason: DENY_INTO }
    }
    if (!toIn) return tree.isRoot(from) ? undefined : { action: 'deny', reason: DENY_OUTSIDE } // the root (Chief) may message any local bot
    if (!allowed) return { action: 'deny', reason: DENY_EDGE }
    return bypassSocial ? { action: 'allow', bypass: ['social'] } : undefined
  }
}
