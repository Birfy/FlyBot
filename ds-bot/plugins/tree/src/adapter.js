// The ONLY file that knows the shape of ctx.flybot (ds-bot types/flybot.d.ts, API version 1).
// Everything goes through flybot.scope('flybot-tree'), so our fields live under
// fields['flybot-tree'] (the unscoped service would write to fields.shared):
//   bot.list() -> BotView[]                         bot.create(spec) -> Promise<BotId>
//   bot.setSystemPrompt(id, text)                   (prompt is BotView.systemPrompt, not a field)
//   fields.get/set(id, key[, value])                SYNC, namespaced to the scope; null/undefined removes
//   on('change' | 'bot.created' | 'bot.removed', fn, { all? }) -> dispose
//     'change' hears only this plugin's fields unless { all: true }
//     'bot.removed' payload: { botId, bot: BotView } after deletion
//   bot.send.use({ name, before?, after?, handle(msg) }) -> dispose
//     msg.target: { remote: false, id } | { remote: true, handle, home }
//   bot.isRemote(ref) -> boolean ({ kind: 'remote' } or '@handle'; local ids never)
//   tools.register({ name, description, parameters, visibleTo(botId) SYNC, execute(args, { botId }) })
//     NOTE: JSON Schema minLength/maxLength are dropped by register; execute() validates them.
export const NS = 'flybot-tree'

export function createAdapter(flybot) {
  if (!flybot) throw new Error('@flybot/tree needs ctx.flybot (ds-bot flybot hooks)')
  if (typeof flybot.scope !== 'function') throw new Error('@flybot/tree needs ctx.flybot.scope (flybot API v1)')
  const fb = flybot.scope(NS)
  const { bot, fields, tools } = fb
  return {
    listBots: () => bot.list() ?? [],
    createBot: async spec => await bot.create(spec),
    getBot: id => bot.get?.(id) ?? (bot.list() ?? []).find(b => b.id === id),
    getSystemPrompt: id => (bot.get?.(id) ?? (bot.list() ?? []).find(b => b.id === id))?.systemPrompt ?? '',
    setSystemPrompt: (id, text) => bot.setSystemPrompt(id, text),
    onBotCreated: fn => fb.on('bot.created', fn),
    getField: (id, key) => fields.get(id, key),
    setField: (id, key, value) => fields.set(id, key, value),
    onFieldChange: fn => fb.on('change', fn),
    // Fires after deletion with the Bot's last record; our fields are under bot.fields['flybot-tree'].
    onBotRemoved: fn => fb.on('bot.removed', e => {
      const own = (e?.bot ?? e)?.fields?.[NS]
      fn({ botId: e?.botId ?? e?.bot?.id, parent: own?.parent ?? (own?.treeRole !== undefined ? null : undefined) })
    }),
    isRemote: ref => bot.isRemote?.(ref) === true,
    useSend: (name, handle) => bot.send.use({ name, before: ['social'], handle }),
    registerTool: spec => tools.register(spec),
  }
}
