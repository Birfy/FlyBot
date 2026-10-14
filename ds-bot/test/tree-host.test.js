// @flybot/tree against the real ctx.flybot host (src/host/hooks.js), not the mock (ThinkFlowLab/FlyBot#6).
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from '../index.js'
import * as tree from '../plugins/tree/index.js'
import { fakeContext } from './fake-ctx.js'

const team = () => ({
  version: 1,
  mainBotIds: ['a'],
  bots: {
    a: { id: 'a', name: 'Chief', role: 'Boss', sessionId: 'a', createdAt: 1 },
    b: { id: 'b', name: 'Writer', role: 'Write', sessionId: 'b', createdAt: 2 },
  },
  rooms: {}, agents: {}, exchanges: [], exchangeTurns: {}, questions: {}, prefs: {}, revision: 0,
})

async function start() {
  const home = mkdtempSync(join(tmpdir(), 'ds-bot-tree-host-'))
  writeFileSync(join(home, 'state.json'), JSON.stringify(team()))
  const ctx = fakeContext()
  const agents = new Map()
  const agentOf = (id) => {
    if (!agents.has(id)) {
      agents.set(id, {
        session: { id, requestHeader: () => undefined }, id, calls: [], status: 'idle',
        followup() {}, steer() {}, inject() {}, cancel() {}, async whenIdle() {}, inbox: { nextStep: [], nextTurn: [], remove() {} },
      })
    }
    return agents.get(id)
  }
  let n = 0
  Object.assign(ctx, {
    llm: { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) },
    workspaceRegistry: { get: () => undefined, resolveByPath: async () => undefined, create: async path => ({ id: 'w1', path }), archiveSession: async () => {} },
    sessionController: { create: async () => ({ sessionId: `s${++n}` }), resolveAgent: async id => ({ agent: agentOf(id) }), selectModel: async () => {}, page: async () => ({ records: [], hasMore: false }) },
    sessionTitle: { rename: async () => {} },
    sessions: { flush: async () => {} },
  })
  apply(ctx, { home })
  const tool = (name, args, sessionId) => ctx.registeredTools.get(name).execute(args, { agent: { id: sessionId } })
  await tool('list_bots', {}, 'a')
  const stop = async () => { await ctx.dispose(); rmSync(home, { recursive: true, force: true, maxRetries: 5 }) }
  return { ctx, fb: ctx.flybot, tool, stop }
}

test('tree plugin on the real host: Chief adopted as root, create_child_bot, scoped fields, send policy, dispose', async () => {
  const h = await start()
  try {
    const { tree: t, dispose } = tree.apply({ flybot: h.fb }, { autoRoot: false })
    assert.equal(await t.ensureRoot(), 'a')
    assert.equal(h.fb.scope('flybot-tree').fields.get('b', 'parent'), 'a') // Writer adopted under Chief
    assert.equal(h.fb.fields.get('b', 'parent'), undefined) // never under fields.shared
    const created = JSON.parse(await h.tool('create_child_bot', { name: 'Work', role_description: 'work stuff' }, 'a')).created
    assert.equal(typeof created.id, 'string'); assert.equal(created.depth, 2)
    const work = created.id
    const dev = JSON.parse(await h.tool('create_child_bot', { name: 'Dev', role_description: 'code' }, h.fb.bot.get(work).sessionId ?? work)).created?.id
    assert.ok(dev, 'child created under the calling bot')
    assert.equal(h.fb.scope('flybot-tree').fields.get(dev, 'parent'), work)
    assert.match(h.fb.bot.get('a').systemPrompt, /Work/)
    assert.match(JSON.parse(await h.tool('create_child_bot', { name: 'x'.repeat(41), role_description: 'r' }, 'a')).error, /at most 40/)
    const send = (from, to, role) => h.fb.bot.send({ from, to, text: 'hi', ...(role ? { role } : {}) })
    assert.equal((await send('a', dev)).action, 'deny') // grandchild
    assert.equal((await send('b', work)).action, 'deny') // sibling
    assert.notEqual((await send('a', work)).action, 'deny')
    assert.equal(h.fb.bot.send.list().some(m => m.name === 'tree'), true)
    dispose()
    assert.equal(h.fb.bot.send.list().some(m => m.name === 'tree'), false)
  } finally {
    await h.stop()
  }
})
