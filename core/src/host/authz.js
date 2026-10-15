// Owner-scoped access (#49): default-deny authorization for the /api/bot channel.
// Once a member session exists on the host, every Bot, room and session an endpoint
// touches must belong to the signed-in actor; shared resources that cannot yet be
// isolated per owner are explicitly blocked. With no session the legacy single-human
// behavior is untouched. This is not team mode: it is the access foundation the team
// gates build on (docs/subsystems/team.md).
//
// Install order matters: right after member-auth, so rt.authzEnforced sees the same
// state.authSessions the sign-in surface writes, and before any module it gates.

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
const ROOM_TARGETED = new Set(['update-room', 'delete-room', 'room-progress', 'create-room'])

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

  // A sessionId may be a Bot's own chat, an earlier part, or a room Session: resolve
  // it to its Bot or room and apply that owner's rule. Unresolvable is a deny.
  const sessionOwnedBy = (actor, sessionId) => {
    const id = String(sessionId ?? '')
    if (id === '') return false
    const botId = rt.botOf?.(id)
    if (botId !== undefined && botId !== null && botId !== false) return botOwnedBy(actor, botId)
    const past = rt.pastOwners?.get(id)
    if (past) {
      if (past.roomId !== undefined) return roomOwnedBy(actor, past.roomId)
      if (past.botId !== undefined) return botOwnedBy(actor, past.botId)
      return false
    }
    for (const room of Object.values(state.rooms || {})) {
      const sessions = room.sessions ?? {}
      if (Object.values(sessions).includes(id) || Object.values(room.segments ?? {}).some(list => (list ?? []).some(s => s?.sessionId === id))) return roomOwnedBy(actor, room.id)
    }
    return false
  }

  rt.botOwnedBy = botOwnedBy
  rt.roomOwnedBy = roomOwnedBy
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
      if (ep === 'stop-member-work') {
        const roomOk = roomOwnedBy(actor, body?.roomId)
        const botOk = botOwnedBy(actor, body?.botId)
        return roomOk || botOk ? ALLOW : deny('bot/forbidden', 'You do not own that Bot or room')
      }
      return requireBot(body?.id ?? body?.botId)
    }

    if (ROOM_TARGETED.has(ep)) {
      if (ep === 'create-room') {
        const members = Array.isArray(body?.members) ? body.members : []
        if (members.length === 0 || members.every(id => botOwnedBy(actor, id))) return ALLOW
        return deny('bot/forbidden', 'You do not own every Bot in that room')
      }
      if (ep === 'update-room') {
        const ids = [body?.id, ...(Array.isArray(body?.members) ? body.members : []), ...(Array.isArray(body?.add) ? body.add : []), ...(Array.isArray(body?.remove) ? body.remove : [])].filter(id => id !== undefined)
        if (ids.every(id => (id === body?.id ? roomOwnedBy(actor, id) : botOwnedBy(actor, id)))) return ALLOW
        return deny('bot/forbidden', 'You do not own that room or one of its Bots')
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
