import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { install as installStore } from '../src/host/store.js'
import { install as installMemberAuth } from '../src/host/member-auth.js'
import { install as installAuthz } from '../src/host/authz.js'

// Owner-scoped access (#49): default-deny for the /api/bot channel once a member
// session exists. Shared deployment resources are blocked while more than one
// member is signed in. Before any session the legacy single-human path is free.

function runtime(t, saved) {
  const dir = mkdtempSync(join(tmpdir(), 'ds-bot-authz-'))
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
  const rt = {
    ctx,
    home: dir,
    statePath,
    autoRoomName: () => 'Room',
    retitleRoom: async () => {},
    warn: (...args) => warnings.push(args),
  }
  installStore(rt)
  installMemberAuth(rt)
  installAuthz(rt)
  t.after(async () => {
    await Promise.all(disposers.splice(0).map(cleanup => cleanup()))
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  })
  return { rt, statePath }
}

const TEAM = {
  version: 2,
  revision: 1,
  mainBotIds: ['m1'],
  members: { 'owner-1': { id: 'owner-1', createdAt: 1, designatedChiefId: 'm1' } },
  bots: { m1: { id: 'm1', sessionId: 'm1', name: 'Chief', instructions: '', createdAt: 1, ownerId: 'owner-1' } },
  rooms: {},
  exchanges: [],
  exchangeTurns: {},
  questions: {},
}

async function redeemOwner(rt) {
  const invite = await rt.createInvitation({ createdByMemberId: 'owner-1' })
  assert.equal(typeof invite.token, 'string')
  return rt.redeemInvitation(invite.token)
}

test('unenforced allows everything', async (t) => {
  const { rt } = runtime(t, TEAM)
  await rt.load()
  assert.equal(rt.authzEnforced(), false)
  assert.equal(rt.authorize(null, 'update-bot', { id: 'm1' }).ok, true)
})

test('owner cannot touch another owner Bot or room', async (t) => {
  const { rt } = runtime(t, TEAM)
  await rt.load()
  const sessionA = await redeemOwner(rt)
  assert.equal(sessionA.ok, true)
  const sessionB = await redeemOwner(rt)
  assert.equal(sessionB.ok, true)
  assert.equal(sessionB.memberId, 'owner-2')

  rt.state.bots.a1 = { id: 'a1', sessionId: 'a1', name: 'A', instructions: '', createdAt: 2, ownerId: 'owner-1' }
  rt.state.bots.b1 = { id: 'b1', sessionId: 'b1', name: 'B', instructions: '', createdAt: 3, ownerId: 'owner-2' }
  rt.state.rooms.ra = { id: 'ra', name: 'RA', members: ['a1'], admin: null }
  rt.state.rooms.rb = { id: 'rb', name: 'RB', members: ['b1'], admin: null }

  const actorA = await rt.authenticate(sessionA.sessionToken)
  assert.ok(actorA)
  assert.equal(actorA.memberId, 'owner-1')
  assert.equal(rt.authorize(actorA, 'update-bot', { id: 'a1' }).ok, true)

  for (const ep of ['update-bot', 'delete-bot', 'memory-view', 'memory-forget', 'set-flags']) {
    const gate = rt.authorize(actorA, ep, { id: 'b1' })
    assert.equal(gate.ok, false, ep)
    assert.equal(gate.code, 'bot/forbidden', ep)
  }

  const sendGate = rt.authorize(actorA, 'send', { sessionId: 'b1' })
  assert.equal(sendGate.ok, false)
  assert.equal(sendGate.code, 'bot/forbidden')

  for (const ep of ['delete-room', 'update-room']) {
    const gate = rt.authorize(actorA, ep, { id: 'rb' })
    assert.equal(gate.ok, false, ep)
    assert.equal(gate.code, 'bot/forbidden', ep)
  }

  const mixed = rt.authorize(actorA, 'create-room', { members: ['a1', 'b1'] })
  assert.equal(mixed.ok, false)
  assert.equal(mixed.code, 'bot/forbidden')

  assert.equal(rt.authorize(actorA, 'create-room', { members: ['a1'] }).ok, true)
})

test('no actor when enforced', async (t) => {
  const { rt } = runtime(t, TEAM)
  await rt.load()
  await redeemOwner(rt)
  await redeemOwner(rt)
  assert.equal(rt.authzEnforced(), true)

  const gate = rt.authorize(null, 'update-bot', { id: 'a1' })
  assert.equal(gate.ok, false)
  assert.equal(gate.code, 'bot/unauthorized')
  assert.equal(rt.authorize(null, 'auth-redeem', {}).ok, true)
  assert.equal(rt.authorize(null, 'auth-whoami', {}).ok, true)
})

test('forged actorId ignored', async (t) => {
  const { rt } = runtime(t, TEAM)
  await rt.load()
  const sessionA = await redeemOwner(rt)
  await redeemOwner(rt)
  rt.state.bots.a1 = { id: 'a1', sessionId: 'a1', name: 'A', instructions: '', createdAt: 2, ownerId: 'owner-1' }
  rt.state.bots.b1 = { id: 'b1', sessionId: 'b1', name: 'B', instructions: '', createdAt: 3, ownerId: 'owner-2' }
  const actorA = await rt.authenticate(sessionA.sessionToken)
  const gate = rt.authorize(actorA, 'update-bot', { id: 'b1', actorId: 'owner-2' })
  assert.equal(gate.ok, false)
  assert.equal(gate.code, 'bot/forbidden')
})

test('shared resources blocked with two members', async (t) => {
  const { rt } = runtime(t, TEAM)
  await rt.load()
  const sessionA = await redeemOwner(rt)
  await redeemOwner(rt)
  const actorA = await rt.authenticate(sessionA.sessionToken)
  for (const ep of ['secret-set', 'connector-connect', 'folders', 'set-prefs', 'diagnostics-log']) {
    const gate = rt.authorize(actorA, ep, {})
    assert.equal(gate.ok, false, ep)
    assert.equal(gate.code, 'bot/blocked-shared', ep)
  }
})

test('shared resources allowed with a single member', async (t) => {
  const { rt } = runtime(t, TEAM)
  await rt.load()
  const sessionA = await redeemOwner(rt)
  assert.equal(rt.authzEnforced(), true)
  assert.equal(Object.keys(rt.state.members).length, 1)
  const actorA = await rt.authenticate(sessionA.sessionToken)
  assert.equal(rt.authorize(actorA, 'secret-set', {}).ok, true)
  assert.equal(rt.authorize(actorA, 'folders', {}).ok, true)
})

test('unknown endpoint denied when enforced', async (t) => {
  const { rt } = runtime(t, TEAM)
  await rt.load()
  const sessionA = await redeemOwner(rt)
  const actorA = await rt.authenticate(sessionA.sessionToken)
  const gate = rt.authorize(actorA, 'not-a-real-endpoint', {})
  assert.equal(gate.ok, false)
  assert.equal(gate.code, 'bot/not-found')
})
