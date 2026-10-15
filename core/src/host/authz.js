// Owner-scoped access (#49): default-deny authorization for the /api/bot channel.
// Once a member session exists on the host, every Bot, room and session an endpoint
// touches must belong to the signed-in actor; shared resources that cannot yet be
// isolated per owner are explicitly blocked. With no session the legacy single-human
// behavior is untouched. This is not team mode: it is the access foundation the team
// gates build on (docs/subsystems/team.md).
//
// Room membership (#50) adds one exception: a signed-in human may reach a room they
// currently belong to (history, send, progress, participant changes they may make),
// even when its Chiefs belong to more than one owner. Specialists and private 1:1
// chats stay owner-scoped. Team mode stays disabled.
//
// Install order matters: right after member-auth, so rt.authzEnforced sees the same
// state.authSessions the sign-in surface writes, and before any module it gates.

import { currentParticipants, isDesignatedChief, roomVisibleTo } from './room-membership.js'

// Endpoints a request without an actor may still reach. auth-invite keeps the
// bootstrap rule in member-auth (first invite signs the installing human in).
const NO_ACTOR_ALLOWED = new Set(['auth-redeem', 'auth-whoami', 'auth-invite'])

// Resources that are one per deployment, not one per owner: blocked outright while
// more than one member exists rather than silently shared.
const SHARED_BLOCKED = new Set([
  'secret-set', 'secret-allow', 'secret-cancel', 'secret-update', 'secret-delete',
  'connector-connect', 'connector-disconnect', 'connector-retry',
  'capability-save', 'capability-delete', 'capability-approve',
  'folders', 'folder-pick', 'folder-list',
  'browser-wait', 'browser-result',
  'update-install', 'dsh-update-install',
  'diagnostics-clear', 'diagnostics', 'diagnostics-log', 'set-prefs',
])

// Endpoints whose body names a Bot (or a resource hanging off one).
const BOT_TARGETED = new Set([
  'update-bot', 'delete-bot', 'duplicate-bot', 'set-flags', 'bot-capability',
  'memory-view', 'memory-ask', 'memory-forget',
  'schedules', 'schedule-create', 'schedule-delete',
  'add-agent', 'agent-session', 'agent-adopt', 'agent-archive', 'agent-rename', 'remove-agent',
  'stop-member-work', 'set-main',
])

// Endpoints whose body names a room.
const ROOM_TARGETED = new Set(['update-room', 'delete-room', 'room-progress', 'create-room', 'room-history', 'room-post'])

// Endpoints whose body names a Session.
const SESSION_TARGETED = new Set(['earlier', 'send', 'answer-question', 'dismiss-question', 'approval-answer', 'exchange'])

const deny = (code, message) => ({ ok: false, code, message })
const ALLOW = { ok: true }

export function install(rt) {
  const { state } = rt

  // Enforced only on a deployment where someone has signed in; before that the
  // single-human product behaves exactly as it always has.
  rt.authzEnforced = () => Object.keys(state.authSessions || {}).length > 0

  const botOwnedBy = (actor, botId) => typeof botId === 'string' && (state.bots || {})[botId]?.ownerId === actor.memberId

  const roomOwnedBy = (actor, roomId) => {
    const room = (state.rooms || {})[String(roomId ?? '')]
    if (!room) return false
    const ids = Object.values(room.members ?? {})
    if (ids.length === 0) return false
    return ids.every(id => {
      const bot = (state.bots || {})[id]
      return bot !== undefined && bot.ownerId === actor.memberId
    })
  }

  // Shared rooms (#50): a current human participant may read and speak. Private
  // owner rooms still match roomOwnedBy (legacy rooms with no participants).
  const roomMemberOf = (actor, roomId) => roomVisibleTo(state, actor, roomId)

  const listedHumans = (body) => {
    const ids = new Set()
    if (Array.isArray(body?.participants)) {
      for (const p of body.participants) {
        if (p?.kind === 'human' && typeof p.id === 'string') ids.add(p.id)
      }
    }
    if (Array.isArray(body?.humans)) {
      for (const id of body.humans) if (typeof id === 'string') ids.add(id)
    }
    return ids
  }

  const permittedSharedBot = (actor, botId, humans) => {
    const bot = (state.bots || {})[botId]
    if (!bot) return false
    if (bot.ownerId === actor.memberId) return true
    const owners = new Set(humans)
    owners.add(actor.memberId)
    return isDesignatedChief(state, botId) && owners.has(bot.ownerId)
  }

  // A sessionId may be a Bot's own chat, an earlier part, or a room Session: resolve
  // it to its Bot or room and apply that owner's rule. Unresolvable is a deny.
  const sessionOwnedBy = (actor, sessionId) => {
    const id = String(sessionId ?? '')
    if (id === '') return false
    if (state.rooms?.[id]) return roomMemberOf(actor, id) || roomOwnedBy(actor, id)
    const botId = rt.botOf?.(id)
    if (botId !== undefined && botId !== null && botId !== false) return botOwnedBy(actor, botId)
    const past = rt.pastOwners?.get(id)
    if (past) {
      if (past.roomId !== undefined) return roomMemberOf(actor, past.roomId) || roomOwnedBy(actor, past.roomId)
      if (past.botId !== undefined) return botOwnedBy(actor, past.botId)
      return false
    }
    for (const room of Object.values(state.rooms || {})) {
      const sessions = room.sessions ?? {}
      if (Object.values(sessions).includes(id) || Object.values(room.segments ?? {}).some(list => (list ?? []).some(s => s?.sessionId === id))) {
        return roomMemberOf(actor, room.id) || roomOwnedBy(actor, room.id)
      }
    }
    return false
  }

  rt.botOwnedBy = botOwnedBy
  rt.roomOwnedBy = roomOwnedBy
  rt.roomMemberOf = roomMemberOf
  rt.sessionOwnedBy = sessionOwnedBy

  rt.authorize = function authorize(actor, endpoint, body) {
    if (!rt.authzEnforced()) return ALLOW
    const ep = String(endpoint ?? '')

    if (!actor) {
      if (NO_ACTOR_ALLOWED.has(ep)) return ALLOW
      return deny('bot/unauthorized', 'Sign in first')
    }

    // Shared deployment-wide resources: one member may still use them, more than
    // one may not until they can be scoped per owner.
    if (SHARED_BLOCKED.has(ep) && Object.keys(state.members || {}).length > 1) {
      return deny('bot/blocked-shared', 'This resource cannot be isolated per owner yet, so it is unavailable while the team has more than one member')
    }
    // Alone on the deployment there is nothing to share: the resource is still one per
    // owner, so the single member reaches it without a per-owner rule.
    if (SHARED_BLOCKED.has(ep)) return ALLOW

    // Body id fields the actor does not own deny the request before the endpoint runs.
    const requireBot = id => (botOwnedBy(actor, id) ? ALLOW : deny('bot/forbidden', 'You do not own that Bot'))
    const requireRoom = id => (roomOwnedBy(actor, id) ? ALLOW : deny('bot/forbidden', 'You do not own that room'))
    const requireSession = id => (sessionOwnedBy(actor, id) ? ALLOW : deny('bot/forbidden', 'You do not own that session'))

    if (BOT_TARGETED.has(ep)) {
      if (ep === 'schedules' || ep === 'schedule-create' || ep === 'schedule-delete') {
        if (ep === 'schedule-delete' && typeof body?.id === 'string' && !sessionOwnedBy(actor, body.id) && !sessionOwnedBy(actor, body.sessionId)) return deny('bot/forbidden', 'You do not own that schedule')
        return requireSession(body?.sessionId)
      }
      if (ep === 'add-agent') return ALLOW
      if (ep.startsWith('agent-') || ep === 'remove-agent') {
        const byBot = botOwnedBy(actor, body?.botId ?? body?.ownerBotId)
        const byAgent = state.agents?.[String(body?.agentId ?? '')]?.ownerId === actor.memberId
        return byBot || byAgent ? ALLOW : deny('bot/forbidden', 'You do not own that agent')
      }
      if (ep === 'usage') return body?.botId === undefined ? ALLOW : requireBot(body.botId)
      if (ep === 'set-main') return requireBot(body?.id)
      if (ep === 'set-flags') {
        const id = body?.id ?? body?.botId
        if (botOwnedBy(actor, id) || roomOwnedBy(actor, id) || roomMemberOf(actor, id)) return ALLOW
        return deny('bot/forbidden', 'You do not own that conversation')
      }
      if (ep === 'stop-member-work') {
        const roomOk = roomOwnedBy(actor, body?.roomId) || roomMemberOf(actor, body?.roomId)
        const botOk = botOwnedBy(actor, body?.botId)
        return roomOk || botOk ? ALLOW : deny('bot/forbidden', 'You do not own that Bot or room')
      }
      return requireBot(body?.id ?? body?.botId)
    }

    if (ROOM_TARGETED.has(ep)) {
      if (ep === 'create-room') {
        const members = Array.isArray(body?.members) ? body.members : []
        const fromParticipants = Array.isArray(body?.participants)
          ? body.participants.filter(p => p?.kind === 'bot' && !p.remote && !p.handle).map(p => p.id)
          : []
        const remotes = [
          ...(Array.isArray(body?.participants) ? body.participants : []),
        ].filter(p => p?.kind === 'bot' && (p.remote || p.handle)).map(p => p.handle || p.id)
        if (remotes.some(handle => !rt.isPublishedRemote?.(handle))) {
          return deny('bot/forbidden', 'Only a Chief or a Bot published to friends may join a shared room')
        }
        const bots = [...new Set([...members, ...fromParticipants])]
        if (bots.length === 0 || bots.every(id => botOwnedBy(actor, id))) return ALLOW
        const humans = listedHumans(body)
        humans.add(actor.memberId)
        if (bots.every(id => permittedSharedBot(actor, id, humans))) return ALLOW
        return deny('bot/forbidden', 'You do not own every Bot in that room')
      }
      if (ep === 'update-room') {
        const roomId = body?.id
        const addedRemotes = [
          ...(Array.isArray(body?.addParticipants) ? body.addParticipants : []),
        ].filter(p => p?.kind === 'bot' && (p.remote || p.handle)).map(p => p.handle || p.id)
        if (addedRemotes.some(handle => !rt.isPublishedRemote?.(handle))) {
          return deny('bot/forbidden', 'Only a Chief or a Bot published to friends may join a shared room')
        }
        if (roomOwnedBy(actor, roomId)) {
          const ids = [...(Array.isArray(body?.members) ? body.members : []), ...(Array.isArray(body?.add) ? body.add : []), ...(Array.isArray(body?.remove) ? body.remove : [])]
          if (ids.every(id => botOwnedBy(actor, id))) return ALLOW
        }
        if (roomMemberOf(actor, roomId)) {
          const humans = listedHumans(body)
          humans.add(actor.memberId)
          for (const p of currentParticipants(state.rooms?.[roomId])) {
            if (p.kind === 'human') humans.add(p.id)
          }
          const bots = [...(Array.isArray(body?.add) ? body.add : []), ...(Array.isArray(body?.members) ? body.members : [])]
          if (bots.every(id => permittedSharedBot(actor, id, humans) || botOwnedBy(actor, id))) return ALLOW
          if (bots.length === 0) return ALLOW
        }
        return deny('bot/forbidden', 'You do not own that room or one of its Bots')
      }
      if (ep === 'room-history' || ep === 'room-progress' || ep === 'room-post') {
        const id = body?.id ?? body?.roomId
        return roomMemberOf(actor, id) || roomOwnedBy(actor, id) ? ALLOW : deny('bot/forbidden', 'You are not a member of that room')
      }
      if (ep === 'delete-room') {
        const id = body?.id ?? body?.roomId
        if (roomOwnedBy(actor, id)) return ALLOW
        const room = state.rooms?.[id]
        const me = currentParticipants(room).find(p => p.kind === 'human' && p.id === actor.memberId)
        return me?.role === 'admin' ? ALLOW : deny('bot/forbidden', 'You do not own that room')
      }
      return requireRoom(body?.id ?? body?.roomId)
    }

    if (SESSION_TARGETED.has(ep)) {
      if (ep === 'exchange') {
        const a = String(body?.a ?? ''), b = String(body?.b ?? '')
        if (a === '' || b === '') return deny('bot/forbidden', 'You do not own that exchange')
        return sessionOwnedBy(actor, a) && sessionOwnedBy(actor, b) ? ALLOW : deny('bot/forbidden', 'You do not own that exchange')
      }
      if (ep === 'approval-answer') return sessionOwnedBy(actor, body?.sessionId) || sessionOwnedBy(actor, body?.id) ? ALLOW : deny('bot/forbidden', 'You do not own that approval')
      return requireSession(body?.sessionId)
    }

    if (ep === 'create-bot') return ALLOW

    // Anything not in the table and not a known auth/read endpoint is denied.
    if (NO_ACTOR_ALLOWED.has(ep) || ep.startsWith('auth-')) return ALLOW
    if (ep === 'state' || ep === 'models' || ep === 'efforts' || ep === 'repo-stars' || ep === 'update-check'
      || ep === 'diagnostics' || ep === 'diagnostics-log' || ep === 'usage') return ALLOW

    return deny('bot/not-found', `Unknown endpoint ${ep}`)
  }

  return rt
}
