// #51: published Bots, the reach policy, and where it is enforced.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRuntime, provideFlyBot } from '../index.js'
import { fakeContext } from './fake-ctx.js'
import { isPublished, reach } from '../src/host/reach.js'

const bot = (id, ownerId, extra = {}) => ({ id, sessionId: id, name: id.toUpperCase(), instructions: '', createdAt: 1, ownerId, ...extra })

// Two owners, each with a Chief (published by default) and a specialist.
const team = () => ({
  version: 2,
  revision: 1,
  mainBotIds: ['a', 'b'],
  members: {
    alice: { id: 'alice', createdAt: 1, designatedChiefId: 'a' },
    bob: { id: 'bob', createdAt: 1, designatedChiefId: 'b' },
  },
  bots: { a: bot('a', 'alice'), a2: bot('a2', 'alice'), b: bot('b', 'bob'), b2: bot('b2', 'bob') },
  rooms: {}, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {},
})


async function start(t, { config = {}, state = team() } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-reach-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(state))
  const ctx = fakeContext()
  const agents = new Map()
  const agentOf = (id) => {
    if (!agents.has(id)) {
      const calls = []
      agents.set(id, {
        session: { id, requestHeader: () => undefined }, id, calls, status: 'idle',
        followup(m) { calls.push(['followup', m]) }, steer(m) { calls.push(['steer', m]) },
        inject() {}, cancel() {}, async whenIdle() {}, inbox: { nextStep: [], nextTurn: [], remove() {} },
      })
    }
    return agents.get(id)
  }
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: { create: async () => ({ sessionId: 's1' }), resolveAgent: async id => ({ agent: agentOf(id) }), selectModel: async () => {}, page: async () => ({ records: [], hasMore: false }) },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  const rt = createRuntime(ctx, { home, ...config })
  provideFlyBot(ctx, rt.flybot)
  await rt.load()
  const received = id => (agents.get(id)?.calls ?? []).map(([, m]) => m.content.map(b => b.text).join('\n'))
  t.after(async () => {
    await ctx.dispose()
    rmSync(home, { recursive: true, force: true, maxRetries: 5 })
  })
  return { rt, fb: rt.flybot, ctx, received, state: rt.state }
}

test('published: false by default, true for the designated Chief, the owner can override either way', () => {
  const s = team()
  assert.equal(isPublished(s, 'a'), true)
  assert.equal(isPublished(s, 'a2'), false)
  s.bots.a2.published = true
  s.bots.a.published = false
  assert.equal(isPublished(s, 'a2'), true)
  assert.equal(isPublished(s, 'a'), false)
  delete s.bots.a.published
  assert.equal(isPublished(s, 'a'), true)
  assert.equal(isPublished(s, 'nobody'), false)
  assert.equal(isPublished(s, '@coder.bob.home'), false)
  // A Bot whose owner left the team is never published, even by choice or as a Chief.
  delete s.members.alice
  assert.equal(isPublished(s, 'a'), false)
  assert.equal(isPublished(s, 'a2'), false)
})

test('reach matrix: remote to local needs a published target; local to remote needs a published sender', () => {
  const s = team()
  const remote = { kind: 'remote', handle: '@coder.bob.home' }
  assert.equal(reach(s, { from: remote, to: 'a' }).action, 'allow', 'a friend reaches a Chief directly')
  const denied = reach(s, { from: remote, to: 'a2' })
  assert.equal(denied.action, 'deny')
  assert.equal(denied.by, 'owner-policy')
  s.bots.a2.published = true
  assert.equal(reach(s, { from: remote, to: 'a2' }).action, 'allow', 'a published specialist is reached without its Chief')
  assert.equal(reach(s, { from: 'a', to: remote }).action, 'allow')
  s.bots.a2.published = false
  assert.equal(reach(s, { from: 'a2', to: remote }).action, 'deny')
  assert.equal(reach(s, { from: 'a2', to: '@coder.bob.home' }).action, 'deny', 'a plain handle is a remote address too')
  assert.equal(reach(s, { from: remote, to: remote }).action, 'deny')
  assert.equal(reach(s, { from: undefined, to: 'a2' }).action, 'allow', 'the owner and the system have no sender Bot')
  assert.equal(reach(s, { from: remote, to: 'nobody' }).action, 'allow', 'an unknown target is refused where it is resolved')
})

test('reach matrix: other owners reach only published Bots, never through the Chief; same owner is free', () => {
  const s = team()
  assert.equal(reach(s, { from: 'a', to: 'b' }).action, 'allow')
  assert.equal(reach(s, { from: 'a', to: 'b2' }).action, 'deny')
  assert.equal(reach(s, { from: 'a2', to: 'b' }).action, 'deny', 'the sender must be published too')
  assert.equal(reach(s, { from: 'a2', to: 'a' }).action, 'allow', 'one owner\'s Bots talk freely')
  s.bots.b2.published = true
  assert.equal(reach(s, { from: 'a', to: 'b2' }).action, 'allow', 'a published non-Chief is reached directly')
  assert.equal(reach(s, { from: 'a2', to: 'b2' }).action, 'deny')
  assert.equal(reach(s, { from: 'b2', to: 'a2' }).action, 'deny')
  delete s.bots.b2.published
  // Chief replaced: the old Chief stops being published at once, the new one starts.
  s.members.bob.designatedChiefId = 'b2'
  assert.equal(reach(s, { from: 'a', to: 'b' }).action, 'deny')
  assert.equal(reach(s, { from: 'a', to: 'b2' }).action, 'allow')
  // Removed owner.
  delete s.members.bob
  assert.equal(reach(s, { from: 'a', to: 'b2' }).action, 'deny')
})

test('reach matrix: a code-joined Bot is reachable inside its room only, while a member', () => {
  const s = team()
  s.rooms.r = {
    id: 'r', members: ['a', 'b2'], participants: [
      { kind: 'human', id: 'alice', role: 'admin', joinedSeq: 0 },
      { kind: 'bot', id: 'a', role: 'admin', joinedSeq: 0 },
      { kind: 'bot', id: 'b2', role: 'member', joinedSeq: 0, viaCode: true },
    ],
  }
  assert.equal(reach(s, { from: 'a', to: 'b2' }).action, 'deny', 'outside the room it is unreachable')
  assert.equal(reach(s, { from: 'a', to: 'b2', roomId: 'r' }).action, 'allow')
  assert.equal(reach(s, { from: 'b2', to: 'a', roomId: 'r' }).action, 'allow')
  assert.equal(reach(s, { from: 'b2', to: 'a', roomId: 'other' }).action, 'deny')
  assert.equal(reach(s, { from: 'b2', to: { kind: 'remote', handle: '@coder.bob.home' }, roomId: 'r' }).action, 'allow')
  assert.equal(reach(s, { from: 'b2', to: { kind: 'remote', handle: '@coder.bob.home' } }).action, 'deny')
  s.rooms.r.participants[2].leftSeq = 3
  s.rooms.r.members = ['a']
  assert.equal(reach(s, { from: 'a', to: 'b2', roomId: 'r' }).action, 'deny', 'after it leaves it is unreachable again')
})

test('bot.send: the policy runs before the chain, and no allow or bypass verdict skips it', async (t) => {
  const { fb, received } = await start(t, { config: { flybot: { bypass: { greedy: ['owner-policy', 'social'] } } } })
  const seen = []
  fb.bot.send.use({ name: 'greedy', priority: 100, handle: (m) => { seen.push(m.to); return { action: 'allow', bypass: ['owner-policy', 'social'] } } })
  const denied = await fb.bot.send({ from: 'a', to: 'b2', text: 'hello specialist' })
  assert.equal(denied.action, 'deny')
  assert.equal(denied.by, 'owner-policy')
  assert.deepEqual(seen, [], 'the chain never saw it')
  assert.deepEqual(received('b2'), [])
  const ok = await fb.bot.send({ from: 'a', to: 'b', text: 'hello chief' })
  assert.equal(ok.action, 'allow')
  assert.equal(seen.length, 1)
  assert.match(received('b')[0], /hello chief/)
})

test('message_bot of another owner\'s unpublished Bot is refused; the owner publishing it opens the way', async (t) => {
  const { fb, rt, received } = await start(t)
  assert.equal((await fb.bot.send({ from: 'a', to: 'b2', text: 'one' })).action, 'deny')
  await rt.setPublished('b2', true)
  assert.equal((await fb.bot.send({ from: 'a', to: 'b2', text: 'two' })).action, 'allow')
  assert.match(received('b2')[0], /two/)
  await rt.setPublished('b2', false)
  assert.equal((await fb.bot.send({ from: 'a', to: 'b2', text: 'three' })).action, 'deny')
  assert.equal(received('b2').length, 1)
})

test('remote senders reach published Bots only', async (t) => {
  const { fb, rt, received } = await start(t)
  const friend = { kind: 'remote', handle: '@coder.bob.home', name: 'Coder' }
  assert.equal((await fb.bot.send({ from: friend, to: 'a2', text: 'hi spec' })).action, 'deny')
  assert.deepEqual(received('a2'), [])
  assert.equal((await fb.bot.send({ from: friend, to: 'a', text: 'hi chief' })).action, 'allow')
  await rt.setPublished('a2', true)
  assert.equal((await fb.bot.send({ from: friend, to: 'a2', text: 'hi again' })).action, 'allow')
  assert.match(received('a2')[0], /hi again/)
})

test('an unpublished Bot cannot message a friend\'s Bot; a published one can', async (t) => {
  const { fb, rt } = await start(t)
  const out = []
  fb.transports.add('bot-social', { send: async msg => { out.push(msg.to.handle); return { exchangeId: `r${out.length}` } } })
  const remote = { kind: 'remote', handle: '@coder.bob.home' }
  assert.equal((await fb.bot.send({ from: 'a2', to: remote, text: 'x' })).action, 'deny')
  assert.deepEqual(out, [])
  assert.equal((await fb.bot.send({ from: 'a', to: remote, text: 'y' })).action, 'allow')
  await rt.setPublished('a2', true)
  assert.equal((await fb.bot.send({ from: 'a2', to: remote, text: 'z' })).action, 'allow')
  assert.equal(out.length, 2)
})

test('a held message is judged again when it is approved: unpublished while it waited means refused', async (t) => {
  const { fb, rt, received } = await start(t)
  await rt.setPublished('b2', true)
  fb.bot.send.use({ name: 'hold-all', handle: () => ({ action: 'hold', reason: 'check' }) })
  const sent = await fb.bot.send({ from: 'a', to: 'b2', text: 'held plan' })
  assert.equal(sent.action, 'hold')
  await rt.setPublished('b2', false)
  const decided = await fb.approvals.decide(sent.approvalId, 'approve')
  assert.equal(decided.status, 'denied')
  assert.match(decided.error, /not published/)
  assert.deepEqual(received('b2'), [])
})

test('resumed, retried, deferred and re-sent deliveries are judged by what is true now', async (t) => {
  const { rt, received } = await start(t)
  const flags = [['resumed', 'x1'], ['retried', 'x2'], ['deferred', 'x3'], ['resent', 'x4']]
  for (const [flag, id] of flags) {
    await rt.deliver({ fromId: 'a', toId: 'b2', role: 'request', text: `${flag} while unpublished`, exchangeId: id, [flag]: true })
  }
  assert.deepEqual(received('b2'), [], 'none of the flagged paths gets around the policy')
  await rt.setPublished('b2', true)
  for (const [flag, id] of flags) {
    await rt.deliver({ fromId: 'a', toId: 'b2', role: 'request', text: `${flag} after publishing`, exchangeId: `${id}-ok`, [flag]: true })
  }
  assert.equal(received('b2').length, 4)
  // The same sender and target in one owner's team are not affected.
  await rt.deliver({ fromId: 'a', toId: 'a2', role: 'request', text: 'same owner', resumed: true })
  assert.match(received('a2')[0], /same owner/)
})

test('a plain delivery from a remote sender to an unpublished Bot is refused', async (t) => {
  const { rt, received } = await start(t)
  await rt.deliver({ toId: 'a2', role: 'request', text: 'hi', remote: { handle: '@coder.bob.home', name: 'Coder' }, untrusted: true, resumed: true })
  assert.deepEqual(received('a2'), [])
  await rt.deliver({ toId: 'a', role: 'request', text: 'hi chief', remote: { handle: '@coder.bob.home', name: 'Coder' }, untrusted: true, resumed: true })
  assert.match(received('a')[0], /hi chief/)
})

test('setPublished: validates, keeps the default with null, emits bot.published, and is the owner\'s call', async (t) => {
  const { fb, rt } = await start(t)
  const events = []
  fb.on('bot.published', bot => events.push([bot.id, bot.published]))
  assert.equal(fb.bot.get('a').published, true)
  assert.equal(fb.bot.get('a2').published, false)
  assert.equal(fb.bot.isPublished('a'), true)
  assert.equal(fb.bot.isPublished('@x.y'), false)
  await rt.setPublished('a2', true)
  await rt.setPublished('a2', true)
  await rt.setPublished('a', false)
  await rt.setPublished('a', null)
  assert.deepEqual(events, [['a2', true], ['a', false], ['a', true]])
  await assert.rejects(rt.setPublished('a2', 'yes'), /true, false or null/)
  await assert.rejects(rt.setPublished('nobody', true), /Unknown Bot/)
})

test('changing the designated Chief changes who is published, and the event says so', async (t) => {
  const solo = team()
  delete solo.members.bob
  solo.bots.b.ownerId = 'alice'
  solo.bots.b2.ownerId = 'alice'
  solo.mainBotIds = ['a']
  const { fb, rt, state } = await start(t, { state: solo })
  const events = []
  fb.on('bot.published', bot => events.push([bot.id, bot.published]))
  assert.equal(fb.bot.isPublished('a'), true)
  state.mainBotIds = ['a2']
  assert.equal(rt.syncDesignatedChief(), true)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(fb.bot.isPublished('a2'), true)
  assert.equal(fb.bot.isPublished('a'), false)
  assert.deepEqual(events.sort(), [['a', false], ['a2', true]])
})

test('the set-published endpoint is the owner\'s: members cannot publish each other\'s Bots', async (t) => {
  const { rt } = await start(t)
  rt.authzEnforced = () => true
  const alice = { memberId: 'alice' }
  assert.equal(rt.authorize(alice, 'set-published', { id: 'a2' }).ok, true)
  assert.equal(rt.authorize(alice, 'set-published', { id: 'b2' }).ok, false)
})
