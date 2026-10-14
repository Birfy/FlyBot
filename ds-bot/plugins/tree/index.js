// @flybot/tree host plugin (dsh / cordis plugin shape, same as ds-bot: name + inject + apply).
// Everything FlyBot-specific goes through ctx.flybot (from @flybot/core) via src/adapter.js.
import { createAdapter } from './src/adapter.js'
import { resolveLimits } from './src/limits.js'
import { createTree } from './src/tree.js'
import { treeSendMiddleware } from './src/middleware.js'
import { registerTreeTools } from './src/tools.js'

export const name = 'flybot-tree'
export const inject = ['flybot']

export function apply(ctx, config = {}) {
  const fb = createAdapter(ctx.flybot)
  const warn = (...args) => (ctx.logger?.('flybot-tree')?.warn ?? console.warn)(...args)
  const tree = createTree(fb, { limits: resolveLimits(config), rootName: config.rootName, rootBotId: config.rootBotId, adoptExisting: config.adoptExisting !== false, warn })
  const disposers = [
    fb.useSend('tree', treeSendMiddleware(tree, { bypassSocial: config.bypassSocial === true, isRemote: fb.isRemote })),
    ...registerTreeTools(fb, tree),
    fb.onFieldChange(change => tree.onFieldChange(change)),
    fb.onBotRemoved(e => tree.onBotRemoved(e)),
  ]
  // The root is ds-bot's Main Bot (Chief). Adopt it once the team is loaded: right away, a few
  // retries later, and whenever a Bot is created (Chief may be created after startup).
  // Each attempt also adopts unattached local bots as the root's children (config.adoptExisting).
  // config.autoRoot: false turns this off; config.rootBotId picks the root explicitly.
  if (config.autoRoot !== false) {
    const attempt = () => tree.ensureRoot().catch(error => warn('flybot-tree: could not set up the root:', error?.message ?? error))
    const timers = [0, 1000, 5000, 15000].map(ms => setTimeout(attempt, ms))
    timers.forEach(t => t.unref?.())
    disposers.push(() => timers.forEach(clearTimeout))
    disposers.push(fb.onBotCreated(() => { setTimeout(attempt, 0).unref?.() }))
  }
  const dispose = () => { for (const d of disposers.splice(0)) d?.() }
  ctx.on?.('dispose', dispose)
  return { tree, dispose }
}
