// Reach policy (#51): who may be reached from outside their owner. One owner- and
// publication-aware check that sits OUTSIDE the plugin send chain, so a middleware's
// `allow` or `bypass` verdict can never skip it. hooks.js runs it before bot.send's
// chain, again when an approved hold is released, and on every other delivery that
// carries a sender (resumed, retried, deferred, re-sent), so a queued message is judged
// by what is true when it is delivered, not when it was written.
//
// A Bot is reachable from another owner only if it is *published*:
//   state.bots[id].published  true | false, set by its owner (rt.setPublished)
//   unset                     the owner's designated Chief is published, every other Bot is not
// A Bot added to one room by its room code (participant `viaCode: true`, #83) is
// reachable only for that room, and only while it is a current member.
// A Bot whose owner is not a team member (removed owner) is never published.
//
// The rules (from → to), `deny` is `{ action: 'deny', reason, by: 'owner-policy' }`:
//   remote → local    the local Bot must be published (a friend cannot reach anything else)
//   local → remote    the sending Bot must be published, or a code-joined member of the room
//                     the message belongs to (an unpublished Bot has no outside identity)
//   local → local     same owner: allowed. Other owner: the sender and the target must be
//                     published, or both current members of the room the message belongs to
//   no sender         the owner or the system: allowed

import { currentParticipants, isDesignatedChief } from './room-membership.js'

export const POLICY = 'owner-policy'

const isRemoteRef = ref => (ref !== null && typeof ref === 'object' && ref.kind === 'remote') || (typeof ref === 'string' && ref.startsWith('@'))
const deny = reason => ({ action: 'deny', reason, by: POLICY })
const ALLOW = Object.freeze({ action: 'allow' })

const ownerKnown = (state, bot) => Boolean(bot?.ownerId && state.members?.[bot.ownerId])

// The Bot's published state now: the owner's explicit choice, else the Chief default.
export function isPublished(state, botId) {
  const bot = state.bots?.[botId]
  if (bot === undefined || bot.remote !== undefined || !ownerKnown(state, bot)) return false
  if (typeof bot.published === 'boolean') return bot.published
  return isDesignatedChief(state, botId)
}

// A Bot that joined this room with its room code: reachable only here, only while a member.
export function isCodeJoined(state, roomId, botId) {
  const room = state.rooms?.[String(roomId ?? '')]
  return room !== undefined && currentParticipants(room).some(p => p.kind === 'bot' && !p.remote && p.id === botId && p.viaCode === true)
}

// May this local Bot take part in a room that has a remote participant or more than one
// owner? Published Bots may; a code-joined Bot may in its own room only.
export function mayShareRoom(state, room, botId) {
  return isPublished(state, botId) || isCodeJoined(state, room?.id, botId)
}

const inRoom = (state, roomId, botId) => {
  const room = state.rooms?.[String(roomId ?? '')]
  return room !== undefined && (room.members ?? []).includes(botId)
}

export function reach(state, { from, to, roomId } = {}) {
  const fromRemote = isRemoteRef(from)
  const toRemote = isRemoteRef(to)
  if (fromRemote && toRemote) return deny('one side must be a local Bot')
  if (fromRemote) {
    const target = state.bots?.[to]
    if (target === undefined) return ALLOW // unknown targets are refused where they are resolved
    if (isPublished(state, to)) return ALLOW
    return deny(`${target.name} is not published, so it cannot be reached from outside`)
  }
  if (from === undefined || from === null) return ALLOW
  const sender = state.bots?.[from]
  if (sender === undefined) return ALLOW
  if (toRemote) {
    if (isPublished(state, from)) return ALLOW
    if (roomId !== undefined && isCodeJoined(state, roomId, from)) return ALLOW
    return deny(`${sender.name} is not published, so it cannot message friends' Bots`)
  }
  const target = state.bots?.[to]
  if (target === undefined) return ALLOW
  if (sender.ownerId === target.ownerId) return ALLOW
  if (!ownerKnown(state, sender) || !ownerKnown(state, target)) return deny('that Bot has no owner on this team')
  if (isPublished(state, from) && isPublished(state, to)) return ALLOW
  if (roomId !== undefined && inRoom(state, roomId, from) && inRoom(state, roomId, to)) return ALLOW
  return deny(`${target.name} is not published, so it cannot be reached by another owner's Bot`)
}

export function install(rt) {
  const { state } = rt

  rt.isPublished = botId => isPublished(state, botId)
  rt.isCodeJoined = (roomId, botId) => isCodeJoined(state, roomId, botId)
  rt.mayShareRoom = (room, botId) => mayShareRoom(state, room, botId)
  // A bot.send message or a deliver() argument set, in either shape.
  rt.reach = (msg = {}) => reach(state, {
    from: msg.remote?.handle ? { kind: 'remote', handle: msg.remote.handle } : (msg.from ?? msg.fromId),
    to: msg.to ?? msg.toId,
    roomId: msg.meta?.roomId ?? msg.roomId ?? msg.fromRoomId ?? msg.deliverArgs?.roomId ?? msg.deliverArgs?.fromRoomId,
  })

  // The owner's choice: true or false; null puts the Bot back on the default (Chief only).
  rt.setPublished = async (botId, value) => {
    const bot = state.bots?.[botId]
    if (bot === undefined || bot.remote !== undefined) throw Object.assign(new Error('Unknown Bot'), { code: 'bot/not-found' })
    if (value !== true && value !== false && value !== null) throw Object.assign(new Error('published must be true, false or null'), { code: 'bot/invalid' })
    const before = isPublished(state, botId)
    if (value === null) delete bot.published
    else bot.published = value
    const after = isPublished(state, botId)
    if (before !== after) await rt.reachChanged(botId)
    await rt.save()
    return after
  }

  // Route eligibility changed (unpublish, Chief replaced, owner removed): a Bot that may no
  // longer be in a room with remote participants or other owners leaves it at once.
  rt.reachChanged = async (botId) => {
    await rt.evictUnshared?.(botId)
    rt.flybotPublishedChanged?.(botId)
  }
  const syncChief = rt.syncDesignatedChief
  if (typeof syncChief === 'function') {
    rt.syncDesignatedChief = (...args) => {
      const before = new Map(Object.keys(state.bots ?? {}).map(id => [id, isPublished(state, id)]))
      const changed = syncChief(...args)
      if (changed) {
        for (const [id, was] of before) if (was !== isPublished(state, id)) void rt.reachChanged(id).catch(error => rt.warn?.('ds-bot: reach change for %s failed: %s', id, error))
      }
      return changed
    }
  }
}
