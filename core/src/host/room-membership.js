// Room membership (#50): typed human and Chief participants, room roles, persistent
// author ids, and membership-window history. This is not team mode — the gates in
// docs/subsystems/team.md stay unsatisfied; there is no flag that turns it on.
//
// Data model (additive; no STATE_VERSION bump). A room may carry `participants`:
//
//   { kind: 'human'|'bot', id, role: 'admin'|'member', displayName,
//     joinedSeq, joinedAt, leftSeq?, leftAt? }
//
// `room.members` stays the current bot ids (existing group rounds, settings, avatars).
// Rooms that never grew `participants` keep the shipped single-owner shape: the owner
// is implicit, every line is visible to that owner, and `who: 'User'` is that owner.
//
// History-visibility rule (membership window):
//   Only a *current* participant may read a room. They see lines whose `seq` is at
//   least the `joinedSeq` of their open interval. Leaving closes the interval and
//   withdraws all history access. Rejoining opens a new interval at the then-current
//   seq; prior intervals do not come back. Non-members cannot read or inject.
//   Specialist 1:1 chats are not rooms and stay owner-private (#49).
//
// Cross-owner rooms: the only legal agent participants are each human's designated
// Chief. Specialists stay in their owner's private rooms.

const KINDS = new Set(['human', 'bot'])
const ROLES = new Set(['admin', 'member'])

export const PARTICIPANT_KINDS = ['human', 'bot']
export const ROOM_ROLES = ['admin', 'member']

const deny = (code, message) => Object.assign(new Error(message), { code })
const invalid = message => deny('bot/invalid', message)
const forbidden = message => deny('bot/forbidden', message)

export function currentParticipants(room) {
  return (room?.participants ?? []).filter(p => p.leftSeq === undefined)
}

export function participantOf(room, kind, id) {
  return currentParticipants(room).find(p => p.kind === kind && p.id === id)
}

export function humanOwnersOf(room, state) {
  const owners = new Set()
  const live = currentParticipants(room)
  if (live.length > 0) {
    for (const p of live) {
      if (p.kind === 'human') owners.add(p.id)
      else {
        const ownerId = state.bots?.[p.id]?.ownerId
        if (ownerId) owners.add(ownerId)
      }
    }
    return owners
  }
  for (const id of room?.members ?? []) {
    const ownerId = state.bots?.[id]?.ownerId
    if (ownerId) owners.add(ownerId)
  }
  return owners
}

export function isCrossOwnerRoom(room, state) {
  return humanOwnersOf(room, state).size > 1
}

export function isDesignatedChief(state, botId) {
  const bot = state.bots?.[botId]
  if (!bot?.ownerId) return false
  return state.members?.[bot.ownerId]?.designatedChiefId === botId
}

export function isSpecialist(state, botId) {
  return state.bots?.[botId] !== undefined && !isDesignatedChief(state, botId)
}

export function displayNameFor(state, memberId, fallback) {
  if (fallback) return fallback
  for (const session of Object.values(state.authSessions || {})) {
    if (session.memberId === memberId && !session.revokedAt && session.displayName) return session.displayName
  }
  for (const room of Object.values(state.rooms || {})) {
    const hit = currentParticipants(room).find(p => p.kind === 'human' && p.id === memberId && p.displayName)
    if (hit) return hit.displayName
  }
  return state.members?.[memberId]?.id ?? memberId
}

// A signed-in human may see a room when they are a current human participant, or
// (legacy / single-owner) when every bot in it belongs to them.
export function roomVisibleTo(state, actor, roomId) {
  if (!actor?.memberId) return false
  const room = state.rooms?.[String(roomId ?? '')]
  if (!room) return false
  if (participantOf(room, 'human', actor.memberId)) return true
  const ids = room.members ?? []
  if (ids.length === 0) return false
  return ids.every(id => state.bots?.[id]?.ownerId === actor.memberId)
}

export function joinedSeqOf(room, actor) {
  const me = participantOf(room, 'human', actor?.memberId)
  return me?.joinedSeq ?? 0
}

// Membership-window filter. Callers must have already checked roomVisibleTo.
export function linesVisibleTo(room, actor) {
  const from = joinedSeqOf(room, actor)
  return (room.log ?? []).filter(line => (line.seq ?? 0) >= from)
}

export function authorOf(line, room, state) {
  if (line?.authorId && line?.authorKind) {
    return { authorId: line.authorId, authorKind: line.authorKind, displayName: line.who || line.authorId }
  }
  if (line?.botId) {
    return { authorId: line.botId, authorKind: 'bot', displayName: line.who || state?.bots?.[line.botId]?.name || line.botId }
  }
  if (line?.who === 'User' || line?.authorKind === 'human') {
    const humans = currentParticipants(room).filter(p => p.kind === 'human')
    const id = humans.length === 1 ? humans[0].id : Object.keys(state?.members || {})[0]
    return { authorId: id, authorKind: 'human', displayName: line.who === 'User' && humans[0]?.displayName ? humans[0].displayName : (line.who || 'User') }
  }
  return { authorId: undefined, authorKind: undefined, displayName: line?.who }
}

export function deriveParticipants(room, state) {
  if (Array.isArray(room.participants)) return room.participants
  const owners = humanOwnersOf(room, state)
  const ownerId = owners.size === 1 ? [...owners][0] : Object.keys(state.members || {})[0]
  const at = room.createdAt ?? 0
  const humans = ownerId
    ? [{ kind: 'human', id: ownerId, role: 'member', displayName: displayNameFor(state, ownerId, 'You'), joinedSeq: 0, joinedAt: at }]
    : []
  const bots = (room.members ?? []).map(id => ({
    kind: 'bot',
    id,
    role: room.admin === id ? 'admin' : 'member',
    displayName: state.bots?.[id]?.name ?? id,
    joinedSeq: 0,
    joinedAt: at,
  }))
  return [...humans, ...bots]
}

function permittedBot(state, room, botId, humans) {
  const bot = state.bots?.[botId]
  if (!bot) return false
  const owners = new Set(humans)
  for (const p of currentParticipants(room)) {
    if (p.kind === 'human') owners.add(p.id)
    else if (state.bots?.[p.id]?.ownerId) owners.add(state.bots[p.id].ownerId)
  }
  if (state.bots[botId]?.ownerId) owners.add(bot.ownerId)
  const cross = owners.size > 1
  if (cross) return isDesignatedChief(state, botId) && humans.has(bot.ownerId)
  return bot.ownerId === [...owners][0]
}

export function install(rt) {
  const { state } = rt

  let roomGate = Promise.resolve()
  const withRoomLock = (fn) => {
    const run = roomGate.then(fn, fn)
    roomGate = run.then(() => {}, () => {})
    return run
  }

  const ensureLog = (room) => {
    if (typeof room.seq !== 'number') {
      room.log = (room.log ?? []).map((line, index) => ({ ...line, seq: index + 1 }))
      room.seq = room.log.length
    }
    room.log ??= []
    room.seen ??= {}
  }

  const append = (room, line) => {
    ensureLog(room)
    room.seq += 1
    const stamped = { ...line, seq: room.seq }
    room.log = [...room.log, stamped].slice(-200)
    return stamped
  }

  const syncMembers = (room) => {
    room.members = currentParticipants(room).filter(p => p.kind === 'bot').map(p => p.id)
    const botAdmin = currentParticipants(room).find(p => p.kind === 'bot' && p.role === 'admin')
    if (botAdmin) room.admin = botAdmin.id
    else if (room.admin && !room.members.includes(room.admin)) room.admin = room.members[0] ?? null
  }

  const materialize = (room) => {
    if (!Array.isArray(room.participants)) room.participants = deriveParticipants(room, state)
    return room
  }

  rt.participantsOf = room => currentParticipants(room)
  rt.roomVisibleTo = (actor, roomId) => roomVisibleTo(state, actor, roomId)
  rt.isCrossOwnerRoom = room => isCrossOwnerRoom(room, state)
  rt.isDesignatedChief = botId => isDesignatedChief(state, botId)
  rt.isSpecialist = botId => isSpecialist(state, botId)
  rt.displayNameFor = (memberId, fallback) => displayNameFor(state, memberId, fallback)
  rt.authorOf = (line, room) => authorOf(line, room, state)
  rt.linesVisibleTo = (room, actor) => linesVisibleTo(room, actor)
  rt.deriveParticipants = room => deriveParticipants(room, state)
  rt.humanOwnersOf = room => humanOwnersOf(room, state)

  rt.canManageParticipants = (room, actor) => {
    if (!rt.authzEnforced?.()) return true
    if (!actor) return false
    if (rt.roomOwnedBy?.(actor, room.id)) return true
    const me = participantOf(room, 'human', actor.memberId)
    return me?.role === 'admin'
  }

  rt.authoredRoomLine = (room, line) => {
    if (line.authorId && line.authorKind) {
      return { ...line, who: line.who || (line.authorKind === 'bot' ? state.bots?.[line.authorId]?.name : displayNameFor(state, line.authorId)) || line.authorId }
    }
    if (line.botId) {
      const name = line.who || state.bots?.[line.botId]?.name || 'Bot'
      return { ...line, who: name, authorId: line.botId, authorKind: 'bot' }
    }
    const humans = currentParticipants(room).filter(p => p.kind === 'human')
    const id = line.authorId || (humans.length === 1 ? humans[0].id : undefined)
    const name = line.who && line.who !== 'User' ? line.who : (id ? displayNameFor(state, id, humans[0]?.displayName) : 'User')
    return { ...line, who: name, ...(id ? { authorId: id, authorKind: 'human' } : {}) }
  }

  function assertAddable(room, draft, actor) {
    if (!KINDS.has(draft.kind)) throw invalid('Participant kind must be human or bot')
    if (typeof draft.id !== 'string' || draft.id === '') throw invalid('A participant needs an id')
    if (draft.role !== undefined && !ROLES.has(draft.role)) throw invalid('Room role must be admin or member')
    if (participantOf(room, draft.kind, draft.id)) throw invalid('That participant is already in the room')
    if (draft.kind === 'human') {
      if (!state.members?.[draft.id]) throw invalid('Unknown team member')
      const humans = new Set(currentParticipants(room).filter(p => p.kind === 'human').map(p => p.id))
      humans.add(draft.id)
      if (humans.size > 1) {
        for (const p of currentParticipants(room).filter(item => item.kind === 'bot')) {
          const ownerId = state.bots?.[p.id]?.ownerId
          if (!isDesignatedChief(state, p.id) || !humans.has(ownerId)) {
            throw forbidden('Specialists stay in their owner\'s private rooms; a cross-owner room takes each side\'s Chief')
          }
        }
      }
      return
    }
    const bot = state.bots?.[draft.id]
    if (!bot) throw invalid('Unknown Bot')
    const humans = new Set(currentParticipants(room).filter(p => p.kind === 'human').map(p => p.id))
    if (actor?.memberId) humans.add(actor.memberId)
    humans.add(bot.ownerId)
    if (!permittedBot(state, room, draft.id, humans)) {
      if (isSpecialist(state, draft.id) && (isCrossOwnerRoom(room, state) || humans.size > 1)) {
        throw forbidden('Specialists stay in their owner\'s private rooms; a cross-owner room takes each side\'s Chief')
      }
      throw forbidden('Only a designated Chief of a room member may join a shared room')
    }
    const nextOwners = new Set(humans)
    if (nextOwners.size > 1) {
      for (const p of currentParticipants(room).filter(item => item.kind === 'bot')) {
        if (isSpecialist(state, p.id)) {
          throw forbidden('Specialists stay in their owner\'s private rooms; a cross-owner room takes each side\'s Chief')
        }
      }
    }
  }

  rt.addRoomParticipant = function addRoomParticipant(roomId, draft, actor) {
    return withRoomLock(async () => {
      const room = rt.roomOf(roomId)
      if (room === undefined) throw invalid('Unknown group chat')
      materialize(room)
      if (rt.authzEnforced?.() && !rt.canManageParticipants(room, actor)) {
        throw forbidden('Only a room admin can add participants')
      }
      const kind = draft.kind
      const id = draft.id
      assertAddable(room, draft, actor)
      const role = draft.role === 'admin' ? 'admin' : 'member'
      const displayName = kind === 'human'
        ? displayNameFor(state, id, draft.displayName)
        : (state.bots[id]?.name ?? draft.displayName ?? id)
      const line = append(room, {
        kind: 'joined',
        who: displayName,
        authorId: id,
        authorKind: kind,
        text: '',
      })
      room.participants.push({
        kind,
        id,
        role,
        displayName,
        joinedSeq: line.seq,
        joinedAt: Date.now(),
      })
      syncMembers(room)
      await rt.save()
      return room
    })
  }

  rt.removeRoomParticipant = function removeRoomParticipant(roomId, ref, actor) {
    return withRoomLock(async () => {
      const room = rt.roomOf(roomId)
      if (room === undefined) throw invalid('Unknown group chat')
      materialize(room)
      const kind = ref.kind
      const id = ref.id
      const me = participantOf(room, kind, id)
      if (!me) throw invalid('That participant is not in the room')
      const selfLeave = actor && kind === 'human' && id === actor.memberId
      if (rt.authzEnforced?.() && !selfLeave && !rt.canManageParticipants(room, actor)) {
        throw forbidden('Only a room admin can remove participants')
      }
      const live = currentParticipants(room)
      const botsLeft = live.filter(p => p.kind === 'bot' && !(kind === 'bot' && p.id === id))
      if (kind === 'bot' && botsLeft.length < 2) throw invalid('A group chat needs at least two Bots')
      const line = append(room, {
        kind: 'left',
        who: me.displayName,
        authorId: id,
        authorKind: kind,
        text: '',
      })
      me.leftSeq = line.seq
      me.leftAt = Date.now()
      if (kind === 'bot') {
        if (room.seen) delete room.seen[id]
        rt.dropGroupSession?.(room, id)
      }
      syncMembers(room)
      await rt.save()
      return room
    })
  }

  rt.postRoomMessage = function postRoomMessage(roomId, { text, authorId, authorKind, displayName } = {}, actor) {
    return withRoomLock(async () => {
      const room = rt.roomOf(roomId)
      if (room === undefined) throw invalid('Unknown group chat')
      const body = String(text ?? '').trim()
      if (body === '') throw invalid('Nothing to send')
      // Actor wins: a forged authorId in the body grants nothing.
      const kind = actor ? 'human' : authorKind
      const id = actor?.memberId ?? authorId
      if (!kind || !id) throw forbidden('Sign in first')
      if (rt.authzEnforced?.() && actor && !roomVisibleTo(state, actor, room.id)) {
        throw forbidden('You are not a member of that room')
      }
      if (Array.isArray(room.participants) || actor) {
        materialize(room)
        if (!participantOf(room, kind, id)) throw forbidden('You are not a member of that room')
      }
      const who = kind === 'human'
        ? displayNameFor(state, id, actor ? actor.displayName : displayName)
        : (state.bots?.[id]?.name ?? displayName ?? id)
      const line = append(room, rt.authoredRoomLine(room, {
        who,
        text: body,
        authorId: id,
        authorKind: kind,
        ...(kind === 'bot' ? { botId: id } : {}),
      }))
      await rt.save()
      return line
    })
  }

  rt.roomHistory = function roomHistory(roomId, actor) {
    const room = rt.roomOf(roomId)
    if (room === undefined) throw invalid('Unknown group chat')
    if (rt.authzEnforced?.() && !roomVisibleTo(state, actor, room.id)) {
      throw forbidden('You are not a member of that room')
    }
    if (!rt.authzEnforced?.() && !actor) return room.log ?? []
    return linesVisibleTo(room, actor)
  }

  rt.applyParticipants = function applyParticipants(room, drafts, actor) {
    if (!Array.isArray(drafts) || drafts.length === 0) return room
    room.participants = []
    const at = room.createdAt ?? Date.now()
    for (const draft of drafts) {
      if (!KINDS.has(draft.kind) || typeof draft.id !== 'string' || draft.id === '') {
        throw invalid('Each participant needs a kind (human or bot) and an id')
      }
      if (draft.role !== undefined && !ROLES.has(draft.role)) throw invalid('Room role must be admin or member')
      if (draft.kind === 'human' && !state.members?.[draft.id]) throw invalid('Unknown team member')
      if (draft.kind === 'bot' && !state.bots?.[draft.id]) throw invalid('Unknown Bot')
      room.participants.push({
        kind: draft.kind,
        id: draft.id,
        role: draft.role === 'admin' ? 'admin' : 'member',
        displayName: draft.kind === 'human'
          ? displayNameFor(state, draft.id, draft.displayName)
          : (state.bots[draft.id]?.name ?? draft.displayName ?? draft.id),
        joinedSeq: 0,
        joinedAt: at,
      })
    }
    if (actor?.memberId && !participantOf(room, 'human', actor.memberId)) {
      room.participants.unshift({
        kind: 'human',
        id: actor.memberId,
        role: 'admin',
        displayName: displayNameFor(state, actor.memberId, actor.displayName),
        joinedSeq: 0,
        joinedAt: at,
      })
    }
    const humans = new Set(currentParticipants(room).filter(p => p.kind === 'human').map(p => p.id))
    for (const p of currentParticipants(room).filter(p => p.kind === 'bot')) {
      if (!permittedBot(state, room, p.id, humans)) {
        throw forbidden('Specialists stay in their owner\'s private rooms; a cross-owner room takes each side\'s Chief')
      }
    }
    syncMembers(room)
    return room
  }

  rt.publicHumans = function publicHumans() {
    return Object.values(state.members || {}).map(member => ({
      id: member.id,
      designatedChiefId: member.designatedChiefId ?? null,
      displayName: displayNameFor(state, member.id),
    }))
  }

  return rt
}
