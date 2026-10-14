import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as plugin from '../index.js'
import { DEFAULT_LIMITS, resolveLimits, checkCreate } from '../src/limits.js'
import { createMockFlybot } from './mock-flybot.js'
import { reactStub, renderToString, findAll } from './render.js'

async function setup(config = {}) {
  const m = createMockFlybot()
  const { tree } = plugin.apply({ flybot: m.flybot }, config)
  const root = await tree.ensureRoot()
  return { ...m, tree, root }
}
const f = (m, id, k) => m.bots.get(id)?.fields['flybot-tree']?.[k]
const sp = (m, id) => m.bots.get(id)?.systemPrompt
const outsider = (m, name = 'Outsider') => m.flybot.bot.create({ name })
const make = async (m, parent, name) => (await m.call(parent, 'create_child_bot', { name, role_description: `${name} stuff` })).created?.id

test('manifest follows dsh plugin conventions', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
  assert.ok(pkg.keywords.includes('dsh-plugin'))
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(plugin.name, 'flybot-tree')
  assert.deepEqual(plugin.inject, ['flybot'])
})

test('limits: defaults, config override, rules', () => {
  assert.deepEqual(DEFAULT_LIMITS, { maxDepth: 5, maxChildren: 8 })
  assert.deepEqual(resolveLimits({ maxDepth: 3 }), { maxDepth: 3, maxChildren: 8 })
  assert.deepEqual(resolveLimits({ maxDepth: -1, maxChildren: 'x' }), DEFAULT_LIMITS)
  const L = { maxDepth: 5, maxChildren: 2 }
  assert.equal(checkCreate({ parentName: 'R', parentDepth: 1, siblings: [], name: 'A', limits: L }), null)
  assert.match(checkCreate({ parentName: 'R', parentDepth: 1, siblings: [{ name: 'a ' }], name: ' A', limits: L }), /already exists/)
  assert.match(checkCreate({ parentName: 'R', parentDepth: 1, siblings: [{ name: 'x' }, { name: 'y' }], name: 'z', limits: L }), /maxChildren=2/)
  assert.match(checkCreate({ parentName: 'R', parentDepth: 5, siblings: [], name: 'z', limits: L }), /depth 6/)
  assert.match(checkCreate({ parentName: 'R', parentDepth: 1, siblings: [], name: '  ', limits: L }), /name required/)
})

test('tree starts with only a root; ensureRoot is idempotent', async () => {
  const m = await setup()
  assert.equal(m.bots.size, 1)
  assert.equal(await m.tree.ensureRoot(), m.root)
  assert.deepEqual((await m.call(m.root, 'list_children')).children, [])
})

test('tools: create under caller only, list, duplicates, depth 5, 8 children', async () => {
  const m = await setup()
  const work = await make(m, m.root, 'Work')
  const dev = await make(m, work, 'Dev')
  assert.equal(f(m, dev, 'parent'), work)
  assert.deepEqual((await m.call(m.root, 'list_children')).children.map(c => c.name), ['Work'])
  assert.match((await m.call(m.root, 'create_child_bot', { name: 'work', role_description: 'dup' })).error, /already exists/)
  const l4 = await make(m, dev, 'L4'); const l5 = await make(m, l4, 'L5')
  assert.ok(l5)
  assert.match((await m.call(l5, 'create_child_bot', { name: 'L6', role_description: 'x' })).error, /maxDepth=5/)
  for (let i = 1; i < 8; i++) assert.ok(await make(m, m.root, `C${i}`))
  assert.match((await m.call(m.root, 'create_child_bot', { name: 'C9', role_description: 'x' })).error, /maxChildren=8/)
  assert.match(sp(m, dev), /recursive bot tree/)
  assert.match(sp(m, dev), /Root → Work → Dev/)
  assert.match(sp(m, work), /COORDINATOR[\s\S]*- Dev: Dev stuff/)
})

test('tools: configurable limits and hidden from non-tree bots', async () => {
  const m = await setup({ maxDepth: 2, maxChildren: 1 })
  const a = await make(m, m.root, 'A')
  assert.match((await m.call(m.root, 'create_child_bot', { name: 'B', role_description: 'x' })).error, /maxChildren=1/)
  assert.match((await m.call(a, 'create_child_bot', { name: 'B', role_description: 'x' })).error, /maxDepth=2/)
  const o = await outsider(m)
  await assert.rejects(m.call(o, 'list_children'), /not visible/)
})

test('fix 1: fields are written under fields["flybot-tree"] via flybot.scope, never shared', async () => {
  const m = await setup()
  assert.ok(m.scopes.includes('flybot-tree'))
  const a = await make(m, m.root, 'A')
  for (const id of [m.root, a]) {
    assert.equal(m.bots.get(id).fields.shared, undefined)
    assert.deepEqual(Object.keys(m.bots.get(id).fields), ['flybot-tree'])
  }
  assert.equal(m.flybot.fields.get(a, 'parent'), undefined) // unscoped (shared) view sees nothing
  assert.equal(m.flybot.scope('flybot-tree').fields.get(a, 'parent'), m.root)
  // a field another plugin writes with the same key does not make a bot a tree member
  const o = await outsider(m); m.flybot.scope('other').fields.set(o, 'parent', m.root)
  await assert.rejects(m.call(o, 'list_children'), /not visible/)
  assert.deepEqual((await m.call(m.root, 'list_children')).children.map(c => c.name), ['A'])
})

test('fix 1: change events: only own plugin unless { all: true }', async () => {
  const m = createMockFlybot()
  const { tree } = plugin.apply({ flybot: m.flybot })
  const seen = []; tree.subscribe(c => seen.push(c.plugin + ':' + c.key))
  const root = await tree.ensureRoot()
  m.flybot.scope('other').fields.set(root, 'parent', 'zzz')
  assert.ok(seen.includes('flybot-tree:parent'))
  assert.ok(!seen.some(s => s.startsWith('other:')))
  const all = []; m.flybot.on('change', c => all.push(c.plugin), { all: true })
  m.flybot.scope('other').fields.set(root, 'x', 1)
  assert.deepEqual(all, ['other'])
})

test('fix 2: create_child_bot returns the resolved id (not a Promise)', async () => {
  const m = await setup()
  assert.equal(typeof m.root, 'string')
  assert.ok(m.bots.has(m.root))
  const r = await m.call(m.root, 'create_child_bot', { name: 'A', role_description: 'a' })
  assert.equal(typeof r.created.id, 'string')
  assert.ok(!(r.created.id instanceof Promise))
  assert.ok(m.bots.has(r.created.id))
  assert.equal(JSON.parse(JSON.stringify(r)).created.id, r.created.id) // survives JSON encoding
  assert.equal(r.created.depth, 2)
  assert.match(sp(m, m.root), /COORDINATOR[\s\S]*- A:/) // parent prompt refreshed after the await
  assert.equal(f(m, r.created.id, 'parent'), m.root)
})

test('send middleware: parent <-> direct child only', async () => {
  const m = await setup()
  const work = await make(m, m.root, 'Work'); const life = await make(m, m.root, 'Life'); const dev = await make(m, work, 'Dev')
  const send = (from, to) => m.flybot.bot.send({ from, to, text: 'hi' })
  assert.equal(m.middlewares[0].before[0], 'social')
  assert.equal((await send(m.root, work)).action, 'allow')
  assert.equal((await send(dev, work)).action, 'allow')
  assert.equal((await send(m.root, dev)).action, 'deny') // grandchild
  assert.equal((await send(dev, m.root)).action, 'deny')
  assert.equal((await send(work, life)).action, 'deny') // sibling
  const o = await outsider(m)
  assert.equal((await send(o, work)).action, 'deny') // non-tree sender may reach only the root
  assert.equal((await send(o, m.root)).action, 'allow')
})

test('fix 3: tree bot -> local non-tree bot (e.g. Chief) is denied; remote still passes', async () => {
  const m = await setup()
  const a = await make(m, m.root, 'A')
  const chief = await outsider(m, 'Chief')
  const h = m.middlewares[0].handle
  const r = h({ from: a, to: chief, target: { remote: false, id: chief } })
  assert.equal(r.action, 'deny'); assert.match(r.reason, /outside the tree/)
  assert.equal((await m.flybot.bot.send({ from: m.root, to: chief, text: 'x' })).action, 'deny')
  assert.equal((await m.flybot.bot.send({ from: chief, to: m.root, text: 'x' })).action, 'allow')
  const other = await outsider(m, 'Other')
  assert.equal((await m.flybot.bot.send({ from: chief, to: other, text: 'x' })).action, 'allow') // non-tree traffic untouched
  // remote targets: real shape (no id) and '@handle'
  assert.equal(h({ from: a, to: { kind: 'remote', handle: '@coder.bob.home', home: '@bob.home' }, target: { remote: true, handle: '@coder.bob.home', home: '@bob.home' } }), undefined)
  assert.equal((await m.flybot.bot.send({ from: a, to: '@coder.bob.home', text: 'x' })).action, 'allow')
  assert.equal(h({ from: a, to: '@coder.bob.home' }), undefined) // isRemote fallback, no target
})

test('send middleware: social bypass only when configured', async () => {
  const off = await setup(); const a = await make(off, off.root, 'A')
  assert.equal(off.middlewares[0].handle({ from: off.root, to: a, target: { remote: false, id: a } }), undefined)
  const on = await setup({ bypassSocial: true }); const b = await make(on, on.root, 'B')
  assert.deepEqual(on.middlewares[0].handle({ from: on.root, to: b, target: { remote: false, id: b } }), { action: 'allow', bypass: ['social'] })
  assert.equal(on.middlewares[0].name, 'tree')
})

test('send chain: social bypass applies only when enabled in config', async () => {
  for (const bypassSocial of [false, true]) {
    const m = await setup({ bypassSocial })
    m.flybot.bot.send.use({ name: 'social', handle: () => ({ action: 'hold', reason: 'needs approval' }) })
    const a = await make(m, m.root, 'A')
    assert.equal((await m.flybot.bot.send({ from: m.root, to: a }, { bypassEnabled: true })).action, bypassSocial ? 'allow' : 'hold')
  }
})

test('send middleware: remote targets pass to social without reading fields', async () => {
  const m = await setup()
  const a = await make(m, m.root, 'A')
  const tf = m.flybot.scope('flybot-tree').fields
  let reads = 0
  const orig = m.bots.get
  const h = m.middlewares[0].handle
  m.bots.get = function (id) { if (typeof id === 'string' && id.startsWith('@')) reads++; return orig.call(this, id) }
  assert.equal(h({ from: a, to: { kind: 'remote', handle: '@x.peer' }, target: { remote: true, handle: '@x.peer', home: '@peer' } }), undefined)
  m.remote.add('remote2')
  assert.equal(h({ from: a, to: 'remote2' }), undefined) // bot.isRemote fallback
  m.bots.get = orig
  assert.equal(reads, 0)
  assert.equal(h({ from: a, target: { id: m.root, remote: false } }), undefined) // child -> parent ok
  assert.equal(tf.get(a, 'parent'), m.root)
})

test('fix 4: create_child_bot enforces minLength/maxLength dropped by tools.register', async () => {
  const m = await setup()
  const params = m.tools.get('create_child_bot').parameters
  assert.equal(params.name.minLength, undefined) // dropped, like the real host
  const c = args => m.call(m.root, 'create_child_bot', args)
  assert.match((await c({ name: '', role_description: 'x' })).error, /name must be at least 1/)
  assert.match((await c({ name: '   ', role_description: 'x' })).error, /name must be at least 1/)
  assert.match((await c({ name: 'x'.repeat(61), role_description: 'x' })).error, /name must be at most 60/)
  assert.match((await c({ name: 'A', role_description: '' })).error, /role_description must be at least 1/)
  assert.match((await c({ name: 'A', role_description: 'r'.repeat(1001) })).error, /role_description must be at most 1000/)
  assert.match((await c({ name: 'A' })).error, /role_description is required/)
  assert.match((await c({ name: 5, role_description: 'x' })).error, /name must be a string/)
  assert.match((await c({ name: 'A', role_description: 'x', parent: 'bot9' })).error, /unknown argument: parent/)
  assert.equal(m.bots.size, 1) // nothing created
  assert.ok((await c({ name: 'x'.repeat(60), role_description: 'r'.repeat(1000) })).created.id)
  assert.match((await m.call(m.root, 'list_children', { junk: 1 })).error, /unknown argument/)
})

test('field-change events reach tree subscribers; dispose unregisters', async () => {
  const m = createMockFlybot()
  const { tree, dispose } = plugin.apply({ flybot: m.flybot })
  const seen = []; tree.subscribe(c => seen.push(c.key))
  const root = await tree.ensureRoot(); await make(m, root, 'A')
  assert.ok(seen.includes('parent'))
  dispose()
  assert.equal(m.tools.size, 0); assert.equal(m.middlewares.length, 0)
})

test('client: injects flybot, registers into FlyBot slots (not the shell slots service)', () => {
  let mod
  globalThis.window = { __ModuleLoader__: { load: ({ id, factory }) => { assert.equal(id, '@flybot/tree'); mod = factory(() => ({ createElement() {}, useEffect() {}, useState() {}, useCallback() {} })) } } }
  new Function(readFileSync(new URL('../client.js', import.meta.url), 'utf8'))()
  assert.deepEqual(mod.inject, ['flybot']) // the browser flybot service carries the FlyBot slots
  assert.equal(mod.name, 'flybot-tree')
  const reg = []
  const effects = []
  const off = mod.apply({ flybot: { slots: { register: (name, entry) => { reg.push([name, entry]); return () => reg.splice(0) } } }, effect: fn => effects.push(fn) })
  assert.equal(reg[0][0], 'flybot.sidebar.section')
  assert.equal(reg[0][1].id, 'flybot-tree'); assert.equal(typeof reg[0][1].component, 'function')
  assert.equal(effects.length, 1)
  off(); assert.equal(reg.length, 0)
  const fo = mod.buildForest({ r: { id: 'r', name: 'Root', parent: null }, w: { id: 'w', name: 'Work', parent: 'r' }, d: { id: 'd', name: 'Dev', parent: 'w' } })
  assert.equal(fo[0].children[0].children[0].name, 'Dev')
})

test('bot.removed: children re-attach to the grandparent, prompts refresh, listeners fire', async () => {
  const m = await setup()
  const work = await make(m, m.root, 'Work'); const dev = await make(m, work, 'Dev')
  const seen = []; m.tree.subscribe(c => seen.push(c.key))
  m.removeBot(work)
  assert.equal(m.flybot.bot.list().some(b => b.id === work), false)
  assert.equal(f(m, dev, 'parent'), m.root)
  assert.ok(seen.includes('removed'))
  assert.match(sp(m, m.root), /- Dev:/)
  assert.doesNotMatch(sp(m, m.root), /- Work:/)
})

test('client builds the tree from ctx.flybot.bots() and fields', async () => {
  let mod
  globalThis.window = { __ModuleLoader__: { load: ({ factory }) => { mod = factory(() => ({ createElement() {}, useEffect() {}, useState() {}, useCallback() {} })) } } }
  new Function(readFileSync(new URL('../client.js', import.meta.url), 'utf8'))()
  const flybot = {
    bots: async () => [
      { id: 'r', name: 'Root', fields: { 'flybot-tree': { parent: null, treeRole: 'x' } } },
      { id: 'w', name: 'Work', fields: { 'flybot-tree': { parent: 'r', treeRole: 'y' }, social: { friends: [] } } },
      { id: 'o', name: 'Other', fields: { social: {} } },
    ],
    fields: { on: () => () => {} },
    on: () => () => {},
  }
  const { nodes } = await mod.treeOf(flybot)
  assert.deepEqual(Object.keys(nodes), ['r', 'w'])
  assert.equal(mod.buildForest(nodes)[0].children[0].name, 'Work')
})

test('bot.removed for a non-tree bot is ignored', async () => {
  const m = await setup()
  const a = await make(m, m.root, 'A')
  const o = await outsider(m)
  m.removeBot(o)
  assert.equal(f(m, a, 'parent'), m.root)
})

test('adapter requires flybot.scope', () => {
  assert.throws(() => plugin.apply({ flybot: { bot: {}, tools: {} } }), /scope/)
})

test('non-tree local sender: only the root is reachable; remote senders unchanged', async () => {
  const m = await setup()
  const a = await make(m, m.root, 'A'); const b = await make(m, a, 'B')
  const chief = await outsider(m, 'Chief')
  const send = (from, to) => m.flybot.bot.send({ from, to, text: 'x' })
  assert.equal((await send(chief, m.root)).action, 'allow')
  for (const t of [a, b]) {
    const r = await send(chief, t)
    assert.equal(r.action, 'deny'); assert.match(r.reason, /only the tree root/)
  }
  const h = m.middlewares[0].handle
  assert.equal(h({ from: { kind: 'remote', handle: '@x.peer' }, to: b, target: { remote: false, id: b } }), undefined) // remote sender
  assert.equal(h({ from: '@x.peer', to: a, target: { remote: false, id: a } }), undefined)
  assert.equal((await send(chief, await outsider(m, 'Other'))).action, 'allow')
  assert.equal((await send(a, '@coder.bob.home')).action, 'allow') // remote target
})

const loadClient = () => {
  let mod
  globalThis.window = { __ModuleLoader__: { load: ({ factory }) => { mod = factory(() => reactStub) } } }
  new Function(readFileSync(new URL('../client.js', import.meta.url), 'utf8'))()
  return mod
}
const sample = mod => mod.buildForest({
  r: { id: 'r', name: 'Root', role: 'Top-level coordinator for everything.', parent: null },
  w: { id: 'w', name: 'Work', role: 'Work tasks\nsecond line', parent: 'r' },
  d: { id: 'd', name: 'Dev', role: 'x'.repeat(300), parent: 'w' },
  l: { id: 'l', name: 'Life', role: '', parent: 'r' },
})

test('sidebar: header shows the node count; nodes render name, one-line role, guide lines', () => {
  const mod = loadClient()
  const html = renderToString(reactStub.createElement(mod.TreeView, { forest: sample(mod) }))
  assert.match(html, /class="flybot-tree-head"[^>]*aria-expanded="true"/)
  assert.match(html, /<span class="flybot-tree-title">Tree<\/span><span class="flybot-tree-count"[^>]*>4<\/span>/)
  assert.match(html, /class="flybot-tree-name">Work</)
  assert.match(html, /class="flybot-tree-role">Work tasks</) // first line only
  assert.doesNotMatch(html, /second line/)
  assert.match(html, /<ul class="flybot-tree-kids"/) // indented children with guide lines
  assert.match(mod.CSS, /\.flybot-tree-role\{[^}]*text-overflow:ellipsis/)
  assert.match(mod.CSS, /\.flybot-tree-kids::before\{[^}]*border-left/)
  assert.match(mod.CSS, /var\(--bt-ink-2/) // ds-bot sidebar tokens, dark theme follows
  assert.doesNotMatch(mod.CSS, /overflow:(auto|scroll)/) // no stray scrollbars
  assert.equal(mod.countNodes(sample(mod)), 4)
})

test('sidebar: empty state (no tree bots, or no root) and collapsed header', () => {
  const mod = loadClient()
  const empty = renderToString(reactStub.createElement(mod.TreeView, { forest: [] }))
  assert.match(empty, /No tree yet\. Ask Root to take on a task and it will create child bots\./)
  assert.match(empty, /class="flybot-tree-count"[^>]*>0</)
  const orphans = mod.buildForest({ a: { id: 'a', name: 'A', parent: 'gone' } }) // no root
  assert.match(renderToString(reactStub.createElement(mod.TreeView, { forest: orphans })), /No tree yet/)
  const closed = renderToString(reactStub.createElement(mod.TreeView, { forest: sample(mod), expanded: false }))
  assert.match(closed, /aria-expanded="false"/)
  assert.doesNotMatch(closed, /flybot-tree-name/)
})

test('sidebar: clicking a node opens its chat via actions.openSession; toggles collapse children', () => {
  const mod = loadClient()
  const opened = []
  let entry
  mod.apply({ flybot: { slots: { register: (n, e) => { entry = e; return () => {} } }, bots: async () => [], fields: { on: () => () => {} } } })
  const Section = entry.component
  const tree = reactStub.createElement(Section, { actions: { openSession: id => opened.push(id) } })
  const buttons = findAll(tree, n => n.props.className === 'flybot-tree-head')
  assert.equal(buttons.length, 1)
  // with data: render the pure view with the same openBot wiring
  const view = reactStub.createElement(mod.TreeView, { forest: sample(mod), openBot: id => opened.push(id) })
  const open = findAll(view, n => n.props.className === 'flybot-tree-open')
  open.find(n => findAll(n, c => c.props.className === 'flybot-tree-name')[0].children[0] === 'Dev').props.onClick()
  assert.deepEqual(opened, ['d'])
  const toggles = findAll(view, n => n.props.className === 'flybot-tree-toggle')
  assert.deepEqual(toggles.map(t => t.props['aria-label']), ['Collapse Root', 'Collapse Work']) // only nodes with children
  // without openSession, node buttons are disabled
  const plain = findAll(reactStub.createElement(mod.TreeView, { forest: sample(mod) }), n => n.props.className === 'flybot-tree-open')
  assert.ok(plain.every(n => n.props.disabled === true))
})

test('root is created automatically on apply (once, even with concurrent ensureRoot)', async () => {
  const m = createMockFlybot()
  const { tree } = plugin.apply({ flybot: m.flybot })
  const [a, b] = await Promise.all([tree.ensureRoot(), tree.ensureRoot()])
  assert.equal(a, b)
  await new Promise(r => setTimeout(r, 10))
  assert.equal(m.bots.size, 1)
  assert.equal([...m.bots.values()][0].name, 'Root')
  const off = createMockFlybot(); plugin.apply({ flybot: off.flybot }, { autoRoot: false })
  await new Promise(r => setTimeout(r, 10))
  assert.equal(off.bots.size, 0)
})
