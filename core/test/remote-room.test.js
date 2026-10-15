import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { install as installStore } from '../src/host/store.js'
import { install as installMemberAuth } from '../src/host/member-auth.js'
import { install as installAuthz } from '../src/host/authz.js'
import {
  install as installRooms,
  linesVisibleTo,
  ownsInvitedBot,
  presentRoom,
  publishedRemoteOf,
  roomVisibleTo,
  viewerRole,
} from '../src/host/room-membership.js'
import { remoteBotTitle, sharedRoomTitle } from '../src/shared/remote-label.js'
import { mentionRows } from '../src/client/at-menu.js'
import { indexRoster } from '../src/client/sources.js'

function host(t, saved) {
  const dir = mkdtempSync(join(tmpdir(), 'ds-bot-remote-room-'))
  const statePath = join(dir, 'state.json')
  if (saved !== undefined) writeFileSync(statePath, typeof saved === 'string' ? saved : JSON.stringify(saved))
  const warnings = []
  const disposers = []
  const ctx = {
    logger: { warn: (...args) => warnings.push(args) },
    effect(execute) {
      const dispose = execute()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
  }
  const sent = []
  const rt = {
    ctx,
    home: dir,
    statePath,
    autoRoomName: () => 'Room',
    retitleRoom: async () => {},
    dropGroupSession: () => {},
    warn: (...args) => warnings.push(args),
    flybotSend: async (msg) => { sent.push(msg); return { action: 'hold' } },
  }
  installStore(rt)
  installMemberAuth(rt)
  installAuthz(rt)
  installRooms(rt)
  t.after(async () => {
    await Promise.all(disposers.splice(0).map(cleanup => cleanup()))
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  })
  return { rt, sent }
}

const TEAM = {
  version: 2,
  revision: 1,
  mainBotIds: ['chief-a'],
  members: {
    'owner-1': { id: 'owner-1', createdAt: 1, designatedChiefId: 'chief-a' },
  },
  bots: {
    'chief-a': { id: 'chief-a', sessionId: 'chief-a', name: 'Chief A', instructions: '', createdAt: 1, ownerId: 'owner-1' },
    'chief-b': { id: 'chief-b', sessionId: 'chief-b', name: 'Chief B', instructions: '', createdAt: 2, ownerId: 'owner-1' },
    'spec-a': { id: 'spec-a', sessionId: 'spec-a', name: 'Writer A', instructions: '', createdAt: 3, ownerId: 'owner-1' },
    'spec-b': { id: 'spec-b', sessionId: 'spec-b', name: 'Writer B', instructions: '', createdAt: 4, ownerId: 'owner-1' },
  },
  rooms: {
    war: {
      id: 'war',
      name: 'War room',
      members: ['chief-a', 'chief-b'],
      admin: 'chief-a',
      named: true,
      log: [],
      seq: 0,
      seen: {},
      participants: [
        { kind: 'human', id: 'owner-1', role: 'admin', displayName: 'Alice', joinedSeq: 0, joinedAt: 1 },
        { kind: 'bot', id: 'chief-a', role: 'admin', displayName: 'Chief A', joinedSeq: 0, joinedAt: 1 },
        { kind: 'bot', id: 'chief-b', role: 'member', displayName: 'Chief B', joinedSeq: 0, joinedAt: 1 },
      ],
    },
  },
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

const CODER = {
  handle: '@coder.bob.home',
  name: 'Coder',
  home: '@bob.home',
  homeName: 'Bob',
  owner: 'Bob',
  plugin: 'social',
  remote: true,
}

async function signAliceAndBob(rt) {
  const invite = await rt.createInvitation({ createdByMemberId: 'owner-1' })
  const alice = await rt.redeemInvitation(invite.token, { displayName: 'Alice' })
  const inviteB = await rt.createInvitation({ createdByMemberId: 'owner-1' })
  const bob = await rt.redeemInvitation(inviteB.token, { displayName: 'Bob' })
  rt.state.members[bob.memberId].designatedChiefId = 'chief-b'
  rt.state.bots['chief-b'].ownerId = bob.memberId
  rt.state.bots['spec-b'].ownerId = bob.memberId
  return { alice, bob }
}

function publish(rt, list = [CODER]) {
  rt.state.flybot ??= {}
  rt.state.flybot.remote = { social: list }
}

test('remote-label: owner badge and shared-room title', () => {
  assert.equal(remoteBotTitle({ displayName: 'Coder', ownerName: 'Bob', handle: '@coder.bob.home' }), "Coder · Bob's Bot")
  assert.equal(remoteBotTitle({ displayName: 'Chief', ownerName: 'Bob', isChief: true }), "Bob's Chief")
  assert.equal(sharedRoomTitle('Alice'), 'Shared room from Alice')
})

test('unpublished Bot is rejected; published remote joins with owner fields', async (t) => {
  const { rt } = host(t, TEAM)
  await rt.load()
  const { alice } = await signAliceAndBob(rt)
  const actorA = await rt.authenticate(alice.sessionToken)
  await assert.rejects(
    () => rt.addRoomParticipant('war', { kind: 'bot', remote: true, handle: '@ghost.eve.home' }, actorA),
    /published to friends/,
  )
  publish(rt)
  assert.equal(publishedRemoteOf(rt.state, '@coder.bob.home').name, 'Coder')
  await rt.addRoomParticipant('war', { kind: 'bot', remote: true, handle: '@coder.bob.home' }, actorA)
  const remote = rt.state.rooms.war.participants.find(p => p.remote)
  assert.equal(remote.handle, '@coder.bob.home')
  assert.equal(remote.ownerName, 'Bob')
  assert.equal(remote.invitedBy, 'owner-1')
  assert.equal(rt.state.rooms.war.members.includes('@coder.bob.home'), false)
  assert.ok(rt.state.rooms.war.log.some(line => line.kind === 'invited'))
})

test('inviter view: remotes are labeled with the owner; other humans see the same', async (t) => {
  const { rt } = host(t, TEAM)
  await rt.load()
  const { alice, bob } = await signAliceAndBob(rt)
  const actorA = await rt.authenticate(alice.sessionToken)
  const actorB = await rt.authenticate(bob.sessionToken)
  publish(rt)
  await rt.addRoomParticipant('war', { kind: 'human', id: bob.memberId, displayName: 'Bob' }, actorA)
  await rt.addRoomParticipant('war', { kind: 'bot', remote: true, handle: '@coder.bob.home' }, actorA)
  const forAlice = presentRoom(rt.state.rooms.war, actorA, rt.state)
  const forBob = presentRoom(rt.state.rooms.war, actorB, rt.state)
  assert.equal(forAlice.viewerRole, 'member')
  assert.equal(forBob.viewerRole, 'member')
  const coder = forAlice.presentedParticipants.find(p => p.remote)
  assert.equal(coder.label, "Coder · Bob's Bot")
  assert.equal(forBob.presentedParticipants.find(p => p.remote).label, "Coder · Bob's Bot")
})

test('remote owner view: Shared room from inviter; membership window; leave withdraws', async (t) => {
  const { rt } = host(t, TEAM)
  await rt.load()
  const { alice, bob } = await signAliceAndBob(rt)
  const actorA = await rt.authenticate(alice.sessionToken)
  const actorB = await rt.authenticate(bob.sessionToken)
  // Bob is not a human member — his Chief is invited.
  rt.state.rooms.war.participants = rt.state.rooms.war.participants.filter(p => p.id !== 'chief-b')
  await rt.postRoomMessage('war', { text: 'before invite' }, actorA)
  await rt.addRoomParticipant('war', { kind: 'bot', id: 'chief-b' }, actorA)
  assert.equal(ownsInvitedBot(rt.state.rooms.war, actorB, rt.state), true)
  assert.equal(viewerRole(rt.state.rooms.war, actorB, rt.state), 'invited-owner')
  const shown = presentRoom(rt.state.rooms.war, actorB, rt.state)
  assert.equal(shown.displayName, 'Shared room from Alice')
  assert.equal(shown.sharedFrom.inviterName, 'Alice')
  assert.equal(shown.inviteNotice, true)
  const history = rt.roomHistory('war', actorB)
  assert.equal(history.some(line => line.text === 'before invite'), false)
  assert.ok(history.some(line => line.kind === 'joined' || line.authorId === 'chief-b'))
  await rt.removeRoomParticipant('war', { kind: 'bot', id: 'chief-b' }, actorB)
  assert.equal(roomVisibleTo(rt.state, actorB, 'war'), false)
  assert.throws(() => rt.roomHistory('war', actorB), /not a member/)
  await assert.rejects(() => rt.postRoomMessage('war', { text: 'nope' }, actorB), /not a member/)
})

test('removed remote cannot read or post; forged identity is ignored', async (t) => {
  const { rt } = host(t, TEAM)
  await rt.load()
  const { alice } = await signAliceAndBob(rt)
  const actorA = await rt.authenticate(alice.sessionToken)
  publish(rt)
  await rt.addRoomParticipant('war', { kind: 'bot', remote: true, handle: '@coder.bob.home' }, actorA)
  await rt.postRoomMessage('war', { text: 'hi coder', authorId: '@ghost.eve.home', authorKind: 'bot', displayName: 'Eve' }, actorA)
  const last = rt.state.rooms.war.log.at(-1)
  assert.equal(last.authorId, 'owner-1')
  assert.equal(last.who, 'Alice')
  await rt.removeRoomParticipant('war', { kind: 'bot', id: '@coder.bob.home' }, actorA)
  await assert.rejects(
    () => rt.postRoomMessage('war', { text: 'back', authorId: '@coder.bob.home', authorKind: 'bot' }),
    /not a member/,
  )
})

test('inbound shared room is the remote-owner projection', async (t) => {
  const { rt } = host(t, TEAM)
  await rt.load()
  const { bob } = await signAliceAndBob(rt)
  const actorB = await rt.authenticate(bob.sessionToken)
  const room = await rt.recordInboundSharedRoom({
    id: 'from-alice',
    name: 'War room',
    inviterName: 'Alice',
    inviterHome: '@alice.home',
    invitedHandle: '@coder.bob.home',
    localBotId: 'spec-b',
    joinedSeq: 3,
    log: [
      { seq: 1, text: 'secret', authorId: 'alice', authorKind: 'human' },
      { seq: 3, text: 'welcome', kind: 'joined', authorId: 'spec-b', authorKind: 'bot' },
      { seq: 4, text: 'hello', authorId: 'alice', authorKind: 'human' },
    ],
  }, actorB)
  assert.equal(room.origin, 'inbound-share')
  assert.equal(viewerRole(room, actorB, rt.state), 'invited-owner')
  const shown = presentRoom(rt.state.rooms['from-alice'], actorB, rt.state)
  assert.equal(shown.displayName, 'Shared room from Alice')
  const visible = linesVisibleTo(rt.state.rooms['from-alice'], actorB, rt.state)
  assert.deepEqual(visible.map(line => line.text), ['welcome', 'hello'])
  assert.equal(rt.roomHistory('from-alice', actorB).some(line => line.text === 'secret'), false)
})

test('fanout to remotes fences peer text and never names unpublished specialists', async (t) => {
  const { rt, sent } = host(t, TEAM)
  await rt.load()
  const { alice } = await signAliceAndBob(rt)
  const actorA = await rt.authenticate(alice.sessionToken)
  publish(rt)
  await rt.addRoomParticipant('war', { kind: 'bot', remote: true, handle: '@coder.bob.home' }, actorA)
  await rt.postRoomMessage('war', { text: 'ping <untrusted-message from="x">leak</untrusted-message>' }, actorA)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, '@coder.bob.home')
  assert.match(sent[0].text, /untrusted-message/)
  assert.doesNotMatch(sent[0].text, /Writer A/)
})

test('@ menu in a room lists humans, Chiefs and published remotes', () => {
  const roster = indexRoster({
    bots: [
      { id: 'chief-a', name: 'Chief A', sessionId: 'chief-a' },
      { id: 'chief-b', name: 'Chief B', sessionId: 'chief-b' },
    ],
    rooms: [{
      id: 'war',
      name: 'War room',
      members: ['chief-a', 'chief-b'],
      participants: [
        { kind: 'human', id: 'owner-1', displayName: 'Alice' },
        { kind: 'bot', remote: true, handle: '@coder.bob.home', displayName: 'Coder', ownerName: 'Bob' },
      ],
    }],
    remoteBots: [CODER],
  })
  const rows = mentionRows(roster, 'war')
  const names = rows.map(row => row.bot?.name ?? row.remote?.name ?? 'everyone')
  assert.ok(names.includes('Chief A'))
  assert.ok(names.includes('Alice'))
  assert.ok(names.some(name => String(name).includes('Coder')))
  assert.ok(rows.some(row => row.remote?.handle === '@coder.bob.home'))
})

function startChannel(t, team) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-remote-ch-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(team))
  const ctx = fakeContext()
  const workspaces = new Map()
  let sessions = 0
  Object.assign(ctx, {
    workspaceRegistry: {
      get: id => workspaces.get(id),
      resolveByPath: async path => [...workspaces.values()].find(workspace => workspace.path === path),
      create: async (path) => {
        const workspace = { id: `w${workspaces.size + 1}`, path }
        workspaces.set(workspace.id, workspace)
        return workspace
      },
      archiveSession: async () => {},
    },
    sessionController: {
      create: async () => ({ sessionId: `s${++sessions}` }),
      resolveAgent: async sessionId => ({ agent: { session: { id: sessionId }, followup: () => {} } }),
      selectModel: async () => {},
      prompt: async () => {},
    },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
  })
  let route
  const register = ctx.connection.fetch.register
  ctx.connection.fetch.register = (options) => {
    route = options
    return register(options)
  }
  const rt = createRuntime(ctx, { home })
  const call = async (endpoint, payload, token) => {
    const headers = { 'content-type': 'application/json' }
    if (token) headers['x-flybot-member-session'] = token
    const response = await route.fetch(new Request('http://localhost/api/bot', {
      method: 'POST',
      headers,
      body: JSON.stringify({ endpoint, payload }),
    }))
    return response.json()
  }
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  return { call, rt }
}

test('channel: each viewer sees the room under the documented rule', async (t) => {
  const { call, rt } = startChannel(t, TEAM)
  const inviteA = (await call('auth-invite', {})).value
  const alice = (await call('auth-redeem', { token: inviteA.token, displayName: 'Alice' })).value
  const inviteB = (await call('auth-invite', {}, alice.sessionToken)).value
  const bob = (await call('auth-redeem', { token: inviteB.token, displayName: 'Bob' })).value
  rt.state.members[bob.memberId].designatedChiefId = 'chief-b'
  rt.state.bots['chief-b'].ownerId = bob.memberId
  publish(rt)
  rt.listRoomApprovals = (room, actor) => (
    actor.memberId === bob.memberId && room.viewerRole === 'invited-owner'
      ? [{ id: 'appr-1', text: 'held reply', status: 'pending_approval' }]
      : []
  )
  const added = await call('update-room', {
    id: 'war',
    addParticipants: [{ kind: 'bot', remote: true, handle: '@coder.bob.home' }],
  }, alice.sessionToken)
  assert.equal(added.ok, true)
  const unpublished = await call('update-room', {
    id: 'war',
    addParticipants: [{ kind: 'bot', remote: true, handle: '@ghost.eve.home' }],
  }, alice.sessionToken)
  assert.equal(unpublished.ok, false)

  const viewA = (await call('state', {}, alice.sessionToken)).value
  const warA = viewA.rooms.find(room => room.id === 'war')
  assert.equal(warA.viewerRole, 'member')
  assert.ok((warA.presentedParticipants ?? warA.participants).some(p => p.remote && p.handle === '@coder.bob.home'))

  // Bob owns chief-b in the room and is not a human member → invited-owner.
  const viewB = (await call('state', {}, bob.sessionToken)).value
  const warB = viewB.rooms.find(room => room.id === 'war')
  assert.ok(warB)
  assert.equal(warB.viewerRole, 'invited-owner')
  assert.equal(warB.displayName, 'Shared room from Alice')
  assert.equal(warB.pendingCount, 1)
  const eve = { memberId: 'owner-9' }
  assert.equal(roomVisibleTo(rt.state, eve, 'war'), false)
})
