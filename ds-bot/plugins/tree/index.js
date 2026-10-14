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
  const tree = createTree(fb, { limits: resolveLimits(config), rootName: config.rootName })
  const disposers = [
    fb.useSend('tree', treeSendMiddleware(tree, { bypassSocial: config.bypassSocial === true, isRemote: fb.isRemote })),
    ...registerTreeTools(fb, tree),
    fb.onFieldChange(change => tree.onFieldChange(change)),
    fb.onBotRemoved(e => tree.onBotRemoved(e)),
  ]
  const dispose = () => { for (const d of disposers.splice(0)) d?.() }
  ctx.on?.('dispose', dispose)
  return { tree, dispose }
}
