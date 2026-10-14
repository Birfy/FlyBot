// Boots the three browser entries (ds-bot's flybot service, @flybot/social, @flybot/tree)
// against the real Cordis 4 the DSH web shell runs, the way its module loader does:
// each client.js registers a factory under its package name, then the plugin is applied.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { createRegistry } from '../src/client/flybot-registry.js'

async function loadCordis() {
  const tries = [() => import('@deepseek-ai/cordis')]
  if (process.env.CORDIS_PATH) tries.unshift(() => import(pathToFileURL(process.env.CORDIS_PATH).href))
  try { tries.push(() => import(pathToFileURL(createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')).resolve('@deepseek-ai/cordis')).href)) } catch {}
  for (const attempt of tries) {
    try { return await attempt() } catch {}
  }
  return undefined
}

function loadClient(dir) {
  const modules = new Map()
  const react = { createElement() {}, useEffect() {}, useState: v => [v, () => {}], useCallback: f => f, Fragment: 'f' }
  const window = { __ModuleLoader__: { load: ({ id, factory }) => modules.set(id, factory(name => (name === 'react' ? react : {}))) } }
  new Function('window', readFileSync(new URL(`../${dir}/client.js`, import.meta.url), 'utf8'))(window)
  return modules
}

test('the social web entry activate under real Cordis once ds-bot provides flybot', async (t) => {
  const cordis = await loadCordis()
  if (!cordis) return t.skip('Cordis 4 not installed (set CORDIS_PATH or install the DSH harness)')
  const registry = createRegistry()
  globalThis.__flybot__ = { slots: registry, call: async () => ({}) }
  t.after(() => { delete globalThis.__flybot__ })
  const root = new cordis.Context()
  const failures = []
  const plugins = [...loadClient('plugins/social')] // @flybot/tree tests its own web entry (repo-root plugins/tree, #34)
  assert.deepEqual(plugins.map(([id]) => id), ['@flybot/social'])
  for (const [id, mod] of plugins) {
    root.plugin({ name: id, inject: mod.inject, apply: (ctx) => { try { return mod.apply(ctx) } catch (error) { failures.push([id, error.message]); throw error } } })
  }
  // ds-bot's browser half provides the flybot service, possibly after the plugins load.
  const flybot = { slots: registry, bots: async () => [], fields: { on: () => () => {} }, call: async () => ({}) }
  root.plugin({ name: 'ds-bot', apply: ctx => ctx.provide('flybot', flybot) })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.deepEqual(failures, [])
  assert.deepEqual(registry.entries('flybot.sidebar.section').map(entry => entry.id).sort(), ['social'])
})
