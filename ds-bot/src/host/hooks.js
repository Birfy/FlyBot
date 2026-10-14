// FlyBot hooks: the `flybot` service feature plugins (plugins/social, plugins/tree)
// build on. Installed after resume.js, so its gate around rt.deliver is the outermost
// wrapper: every Bot-to-Bot message, including message_bot, stop_bot, and replies,
// passes the send middleware chain exactly once.
//
// Persisted in state.json with the team:
//   state.bots[id].fields[plugin][key]   custom fields (bot.fields)
//   state.bots[id].systemPrompt          plugin prompt text (prompt.js appends it)
//   state.flybot.approvals[id]           sends held for the owner's decision
// Types: ds-bot/types/flybot.d.ts. Plugins call flybot.scope('<plugin>') to get the
// same API with their own field namespace; the unscoped API uses namespace 'shared'.
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const FLYBOT_API_VERSION = 1
export const SHARED = 'shared'
// Roles that are one Bot talking to another; group rounds, kickoffs, and notices are not.
const BOT_TO_BOT_ROLES = new Set(['request', 'reply', 'stopped', 'report'])
const ACTIONS = new Set(['allow', 'deny', 'hold'])
const APPROVALS_KEPT = 200
const CHANGES_KEPT = 500
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// A remote address: { kind: 'remote', handle, home? } or a '@handle' string. Remote Bots
// are never in bot.list(); their handle is '@<bot>.<home>' (home '@<home>') or a plain
// per-bot identity.
const isRemote = ref => (ref !== null && typeof ref === 'object' && ref.kind === 'remote') || (typeof ref === 'string' && ref.startsWith('@'))
const homeOfHandle = handle => {
  const parts = String(handle).replace(/^@/, '').split('.')
  return parts.length > 2 ? `@${parts.slice(1).join('.')}` : `@${parts.join('.')}`
}
export const toRemote = (ref) => {
  if (!isRemote(ref)) return undefined
  const handle = `@${String(typeof ref === 'string' ? ref : ref.handle).replace(/^@+/, '').toLowerCase()}`
  return { kind: 'remote', handle, home: typeof ref === 'object' && ref.home ? ref.home : homeOfHandle(handle), ...(typeof ref === 'object' && ref.name ? { name: ref.name } : {}), ...(typeof ref === 'object' && ref.transport ? { transport: ref.transport } : {}) }
}
const targetOf = ref => (isRemote(ref) ? { remote: true, handle: toRemote(ref).handle, home: toRemote(ref).home } : { remote: false, id: ref })
const checkName = (kind, value) => {
  if (typeof value !== 'string' || !NAME.test(value)) throw new Error(`flybot: invalid ${kind} ${JSON.stringify(value)}`)
}

// Orders middleware by before/after names; ties keep registration order. A cycle
// falls back to registration order for the entries left.
export function orderMiddleware(list) {
  const names = new Set(list.map(m => m.name))
  const after = new Map(list.map(m => [m.name, new Set()]))
  for (const m of list) {
    for (const other of m.before ?? []) if (names.has(other)) after.get(other).add(m.name)
    for (const other of m.after ?? []) if (names.has(other)) after.get(m.name).add(other)
  }
  const done = new Set()
  const out = []
  while (out.length < list.length) {
    const next = list.find(m => !done.has(m.name) && [...after.get(m.name)].every(n => done.has(n)))
      ?? list.find(m => !done.has(m.name))
    done.add(next.name)
    out.push(next)
  }
  return out
}

// Tools may give DSH's parameter map or a JSON Schema object; a schema becomes the map
// (its `required` list moves onto each property).
export function toParameterMap(parameters) {
  if (parameters?.type !== 'object' || typeof parameters.properties !== 'object') return parameters ?? {}
  const required = new Set(parameters.required ?? [])
  // DSH's value DSL takes type, description, enum, and items; other keywords
  // (minLength, maxLength, ...) are dropped, so execute() must still check them.
  const keep = ({ type, description, enum: values, items }) => ({ type, ...(description ? { description } : {}), ...(values ? { enum: values } : {}), ...(items ? { items: keep(items) } : {}) })
  return Object.fromEntries(Object.entries(parameters.properties).map(([key, schema]) => [key, { ...keep(schema), ...(required.has(key) ? { required: true } : {}) }]))
}

export function install(rt) {
  const { ctx, state, config } = rt
  // config.flybot.bypass: { <middleware that asks>: [<middleware names it may skip>] }
  const bypassGrants = config?.flybot?.bypass ?? {}
  const warn = (...args) => rt.warn?.(...args)
  const emit = (name, payload) => { try { ctx.emit?.(name, payload) } catch (error) { warn('flybot: %s listener failed: %s', name, error) } }

  // ---------------------------------------------------------------- events
  const listeners = { 'change': new Set(), 'bot.created': new Set(), 'bot.removed': new Set() }
  const changes = []
  let changeSeq = 0
  const fire = (event, payload) => {
    if (event === 'change') {
      changes.push({ seq: ++changeSeq, ...payload })
      if (changes.length > CHANGES_KEPT) changes.shift()
    }
    for (const fn of [...listeners[event]]) {
      try { fn({ ...payload }) } catch (error) { warn('flybot: %s listener failed: %s', event, error) }
    }
    emit(`flybot/${event}`, clone(payload))
  }
  // Cordis-style subscription, returns a disposer. 'change' listeners hear their own
  // plugin's fields unless they pass { all: true }; 'bot.removed' hears every removal.
  const onFor = plugin => (event, fn, { all = false } = {}) => {
    if (!listeners[event]) throw new Error(`flybot: unknown event ${event}; use 'change', 'bot.created', or 'bot.removed'`)
    const listener = event === 'change' && !all ? change => { if (change.plugin === plugin) fn(change) } : fn
    listeners[event].add(listener)
    return () => listeners[event].delete(listener)
  }

  // ---------------------------------------------------------------- bots
  const view = bot => (bot === undefined ? undefined : {
    id: bot.id, name: bot.name, role: bot.role, isMain: rt.isMain(bot.id), createdBy: bot.createdBy ?? null,
    systemPrompt: bot.systemPrompt ?? '', fields: clone(bot.fields ?? {}),
  })
  const persist = () => { void rt.save().catch(error => warn('flybot: save failed: %s', error)) }

  async function create({ name, systemPrompt, fields, role, instructions, createdBy, plugin = SHARED } = {}) {
    checkName('plugin', plugin)
    await rt.load()
    const bot = await rt.createBot({
      name, role, instructions, createdBy,
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(fields && Object.keys(fields).length > 0 ? { fields: { [plugin]: fields } } : {}),
    })
    for (const [key, value] of Object.entries(fields ?? {})) fire('change', { botId: bot.id, plugin, key, value: clone(value), prev: undefined })
    return bot.id
  }
  function setSystemPrompt(id, text) {
    const bot = rt.botOf(id)
    if (bot === undefined) throw new Error(`flybot: unknown Bot ${id}`)
    const clean = String(text ?? '').trim()
    if ((bot.systemPrompt ?? '') === clean) return
    if (clean) bot.systemPrompt = clean
    else delete bot.systemPrompt
    persist()
  }
  // Every new Bot (UI, create_bot, plugins) is announced with its record.
  const createBot = rt.createBot
  if (typeof createBot === 'function') {
    rt.createBot = async (...args) => {
      const bot = await createBot(...args)
      if (bot?.id !== undefined) fire('bot.created', view(rt.botOf(bot.id)) ?? view(bot))
      return bot
    }
  }
  // A deleted Bot's fields go with it: one 'bot.removed', no per-field events.
  const deleteBot = rt.deleteBot
  if (typeof deleteBot === 'function') {
    rt.deleteBot = async (id, ...rest) => {
      // Fires after removal; the payload keeps the Bot's last record, fields included.
      const last = view(rt.botOf(id))
      const result = await deleteBot(id, ...rest)
      fire('bot.removed', { ...last, botId: id, bot: last })
      return result
    }
  }

  // ---------------------------------------------------------------- fields (synchronous)
  const fieldsFor = (plugin) => {
    checkName('plugin', plugin)
    const on = onFor(plugin)
    return {
      get(botId, key) {
        return clone(rt.botOf(botId)?.fields?.[plugin]?.[key])
      },
      all(botId) {
        return clone(rt.botOf(botId)?.fields?.[plugin] ?? {})
      },
      // Saves in the background; null or undefined removes the key.
      set(botId, key, value) {
        if (typeof key !== 'string' || key === '') throw new Error('flybot: a field needs a key')
        const bot = rt.botOf(botId)
        if (bot === undefined) throw new Error(`flybot: unknown Bot ${botId}`)
        const prev = clone(bot.fields?.[plugin]?.[key])
        const next = value === null ? undefined : clone(value)
        if (same(prev, next)) return
        bot.fields ??= {}
        bot.fields[plugin] ??= {}
        if (next === undefined) delete bot.fields[plugin][key]
        else bot.fields[plugin][key] = next
        if (Object.keys(bot.fields[plugin]).length === 0) delete bot.fields[plugin]
        if (Object.keys(bot.fields).length === 0) delete bot.fields
        persist()
        fire('change', { botId, plugin, key, value: next, prev })
      },
      // Bots that have the key; with `value`, only those whose value deep-equals it.
      query(key, value) {
        return Object.values(state.bots)
          .filter(bot => bot.fields?.[plugin] !== undefined && Object.hasOwn(bot.fields[plugin], key) && (value === undefined || same(bot.fields[plugin][key], value)))
          .map(view)
      },
      on,
    }
  }

  // ---------------------------------------------------------------- send middleware
  let chain = []
  const use = (middleware) => {
    checkName('middleware name', middleware?.name)
    if (typeof middleware.handle !== 'function') throw new Error('flybot: middleware needs handle()')
    if (chain.some(m => m.name === middleware.name)) throw new Error(`flybot: middleware ${middleware.name} exists`)
    chain = orderMiddleware([...chain, middleware])
    return () => { chain = chain.filter(m => m !== middleware) }
  }
  const evaluate = async (msg) => {
    const skip = new Set()
    for (const middleware of chain) {
      if (skip.has(middleware.name)) continue
      let verdict
      try {
        verdict = await middleware.handle(clone(msg))
      } catch (error) {
        return { action: 'deny', reason: `${middleware.name} failed: ${error?.message ?? error}`, by: middleware.name }
      }
      if (verdict === undefined || verdict === null) continue
      if (!ACTIONS.has(verdict.action)) return { action: 'deny', reason: `${middleware.name} returned ${JSON.stringify(verdict.action)}`, by: middleware.name }
      if (verdict.action === 'allow') {
        // A bypass counts only for names config grants to this middleware.
        const granted = bypassGrants[middleware.name] ?? []
        for (const name of verdict.bypass ?? []) {
          if (granted.includes(name) || granted.includes('*')) skip.add(name)
        }
        continue
      }
      return { action: verdict.action, reason: verdict.reason || `${verdict.action} by ${middleware.name}`, by: middleware.name }
    }
    return { action: 'allow' }
  }

  const transports = new Map()
  const addTransport = (kind, transport) => {
    if (transports.has(kind)) throw new Error(`flybot: transport ${kind} exists`)
    transports.set(kind, transport)
    return () => transports.delete(kind)
  }

  // ---------------------------------------------------------------- approvals
  const store = () => {
    state.flybot ??= {}
    state.flybot.approvals ??= {}
    return state.flybot.approvals
  }
  const approvalListeners = new Set()
  const approvalsChanged = (approval) => {
    for (const fn of [...approvalListeners]) {
      try { fn(clone(approval)) } catch (error) { warn('flybot: approval listener failed: %s', error) }
    }
    emit('flybot/approval', clone(approval))
  }

  let innerDeliver
  const dispatch = async (msg) => {
    if (isRemote(msg.to)) {
      const kind = msg.to.transport ?? 'bot-social'
      const transport = transports.get(kind)
      if (transport === undefined) throw new Error(`flybot: no transport ${kind}`)
      const { deliverArgs, ...plain } = msg
      const result = await transport.send(clone(plain))
      return result?.exchangeId ?? msg.exchangeId
    }
    return innerDeliver({ ...msg.deliverArgs, flybotChecked: true })
  }

  const hold = async (msg, verdict) => {
    await rt.load()
    const approval = { id: randomUUID(), status: 'pending', reason: verdict.reason, by: verdict.by, createdAt: Date.now(), request: clone(msg) }
    const all = store()
    all[approval.id] = approval
    const done = Object.values(all).filter(a => a.status !== 'pending').sort((a, b) => a.createdAt - b.createdAt)
    for (const old of done.slice(0, Math.max(0, Object.keys(all).length - APPROVALS_KEPT))) delete all[old.id]
    await rt.save()
    approvalsChanged(approval)
    return approval
  }

  const approvals = {
    list: ({ status = 'pending' } = {}) => Object.values(store()).filter(a => status === 'all' || a.status === status).sort((a, b) => a.createdAt - b.createdAt).map(clone),
    get: id => clone(store()[id]),
    // Owner only: reachable from the UI route, never a model tool.
    async decide(id, decision, { note } = {}) {
      await rt.load()
      const approval = store()[id]
      if (approval === undefined) throw new Error(`flybot: no approval ${id}`)
      if (approval.status !== 'pending') throw new Error(`flybot: approval ${id} is already ${approval.status}`)
      if (decision !== 'approve' && decision !== 'reject') throw new Error('flybot: decision is approve or reject')
      approval.status = decision === 'approve' ? 'approved' : 'rejected'
      approval.decidedAt = Date.now()
      if (note) approval.note = String(note)
      if (decision === 'approve') {
        try {
          approval.exchangeId = await dispatch(approval.request)
        } catch (error) {
          approval.status = 'failed'
          approval.error = error?.message ?? String(error)
        }
      }
      await rt.save()
      approvalsChanged(approval)
      return clone(approval)
    },
    onChange(fn) {
      approvalListeners.add(fn)
      return () => approvalListeners.delete(fn)
    },
  }

  // ---------------------------------------------------------------- bot.send
  const outcomes = new Map()
  const noteOutcome = (exchangeId, outcome) => {
    outcomes.set(exchangeId, outcome)
    if (outcomes.size > 500) outcomes.delete(outcomes.keys().next().value)
  }
  const run = async (msg) => {
    const verdict = await evaluate(msg)
    if (verdict.action === 'deny') return { action: 'deny', reason: verdict.reason, by: verdict.by }
    if (verdict.action === 'hold') {
      const approval = await hold(msg, verdict)
      return { action: 'hold', approvalId: approval.id, reason: verdict.reason, by: verdict.by }
    }
    return { action: 'allow', exchangeId: await dispatch(msg) }
  }

  async function send({ from, to, text, role = 'request', hop = 0, via = SHARED, meta } = {}) {
    await rt.load()
    if (typeof text !== 'string' || text.trim() === '') throw new Error('flybot: send needs text')
    if (role !== 'request' && role !== 'reply') throw new Error(`flybot: unsupported role ${role}`)
    if (!isRemote(from) && rt.botOf(from) === undefined) throw new Error(`flybot: unknown sender ${from}`)
    if (!isRemote(to) && rt.botOf(to) === undefined) throw new Error(`flybot: unknown Bot ${to}`)
    if (isRemote(from) && isRemote(to)) throw new Error('flybot: one side must be a local Bot')
    from = isRemote(from) ? toRemote(from) : from
    to = isRemote(to) ? toRemote(to) : to
    const exchangeId = randomUUID()
    const msg = { from, to, target: targetOf(to), text, role, hop, via, exchangeId, ...(meta ? { meta } : {}) }
    if (!isRemote(to)) {
      msg.deliverArgs = isRemote(from)
        ? { toId: to, role, hop, text, exchangeId, fromName: from.name ?? remoteMembers.get(from.handle)?.name ?? from.handle, untrusted: true, remote: { handle: from.handle, home: from.home } }
        : { fromId: from, toId: to, role, hop, text, exchangeId }
    }
    const result = await run(msg)
    noteOutcome(exchangeId, result)
    return result
  }
  send.use = use
  send.list = () => chain.map(({ name, before, after }) => ({ name, before: before ?? [], after: after ?? [] }))

  // The gate around ds-bot's own rt.deliver. Approved and re-sent messages pass through.
  const gated = args => args.fromId !== undefined && rt.botOf(args.fromId) !== undefined && BOT_TO_BOT_ROLES.has(args.role)
    && !args.flybotChecked && !args.resent && !args.resumed && !args.retried && !args.deferred
  innerDeliver = rt.deliver
  rt.deliver = async (args) => {
    if (!gated(args)) return innerDeliver(args)
    const exchangeId = args.exchangeId ?? randomUUID()
    const msg = { from: args.fromId, to: args.toId, target: targetOf(args.toId), text: args.text, role: args.role, hop: args.hop ?? 0, via: 'ds-bot', exchangeId, deliverArgs: { ...args, exchangeId } }
    noteOutcome(exchangeId, await run(msg))
    return exchangeId
  }

  // ---------------------------------------------------------------- tools
  const callerOf = exec => rt.botOf(rt.selfOf(exec?.agent?.id))
  const visible = (def, botId) => {
    if (botId === undefined) return false
    if (typeof def.visibleTo !== 'function') return true
    const answer = def.visibleTo(botId)
    // visibleTo is synchronous by contract; a Promise is settled again in execute.
    return answer instanceof Promise ? true : Boolean(answer)
  }
  const tools = {
    register(def) {
      if (typeof def?.name !== 'string' || typeof def.execute !== 'function') throw new Error('flybot: a tool needs a name and execute()')
      const refusal = `${def.name} is not available to this Bot.`
      const disposeGuard = ctx.tools.guard?.(exec => (exec.name === def.name && !visible(def, callerOf(exec)?.id) ? refusal : undefined))
      const { visibleTo, ...spec } = def
      spec.parameters = toParameterMap(spec.parameters)
      const disposeTool = ctx.tools.register(defineTool({
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
        ...spec,
        async execute(args, exec) {
          await rt.load()
          const botId = callerOf(exec)?.id
          if (botId === undefined || (visibleTo && !(await visibleTo(botId)))) throw new Error(refusal)
          const result = await def.execute(args, { ...exec, botId })
          return typeof result === 'string' ? result : JSON.stringify(result)
        },
      }))
      return () => {
        disposeTool?.()
        disposeGuard?.()
      }
    },
  }

  // ---------------------------------------------------------------- remote members
  // Remote Bots a plugin can reach (social: friends' Bots). They are chat members the
  // UI shows with a remote badge and the "@" menu offers, never team Bots (bot.list()).
  // Kept in state.json so the roster revision moves when they change.
  const remoteStore = () => {
    state.flybot ??= {}
    state.flybot.remote ??= {}
    return state.flybot.remote
  }
  const cleanRemote = (plugin, bot) => {
    const remote = toRemote(bot.handle)
    return { handle: remote.handle, home: bot.home ? toRemote(bot.home).handle : remote.home, name: String(bot.name ?? remote.handle).slice(0, 60), ...(bot.homeName ? { homeName: String(bot.homeName).slice(0, 60) } : {}), ...(bot.owner ? { owner: String(bot.owner).slice(0, 60) } : {}), plugin, remote: true }
  }
  const remoteMembers = {
    // Replaces this plugin's list; saves only when it changed.
    publish(plugin, list) {
      checkName('plugin', plugin)
      const next = (list ?? []).filter(bot => typeof bot?.handle === 'string').map(bot => cleanRemote(plugin, bot))
      const all = remoteStore()
      if (same(all[plugin] ?? [], next)) return
      if (next.length === 0) delete all[plugin]
      else all[plugin] = next
      persist()
    },
    list: () => Object.values(state.flybot?.remote ?? {}).flat().map(clone),
    get: handle => remoteMembers.list().find(bot => bot.handle === toRemote(handle)?.handle),
  }

  // The user's "@handle" of a remote member in a Bot's chat or a group goes out through
  // bot.send (so the social middleware still decides), from that Bot or the group's admin.
  const MENTION = /(^|[^a-z0-9_./@])@([a-z0-9][a-z0-9._-]*[a-z0-9])/gi
  const seenUserMessages = new Set()
  async function sendUserMentions(sessionId, text, key) {
    if (seenUserMessages.has(key)) return []
    seenUserMessages.add(key)
    if (seenUserMessages.size > 1000) seenUserMessages.delete(seenUserMessages.values().next().value)
    const known = new Map(remoteMembers.list().map(bot => [bot.handle, bot]))
    if (known.size === 0) return []
    const room = rt.roomOf(rt.groupOwners?.get(sessionId)?.roomId ?? sessionId)
    const from = room ? (room.admin ?? room.members?.[0]) : rt.selfOf(sessionId)
    if (from === undefined || rt.botOf(from) === undefined) return []
    const handles = new Set()
    for (const match of text.matchAll(MENTION)) {
      const handle = `@${match[2].toLowerCase()}`
      if (known.has(handle)) handles.add(handle)
    }
    const results = []
    for (const handle of handles) {
      try {
        results.push({ handle, ...(await send({ from, to: handle, text, via: 'user-mention', meta: { sessionId } })) })
      } catch (error) {
        warn('flybot: sending to %s failed: %s', handle, error)
        results.push({ handle, action: 'deny', reason: error?.message ?? String(error) })
      }
    }
    return results
  }
  const textOfContent = content => (Array.isArray(content) ? content.map(block => (block?.type === 'text' ? block.text : '')).join('\n') : String(content ?? ''))
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'user/message') return
    const source = event.data?.source
    if (source !== undefined && source !== null && source.kind !== 'user') return
    const id = session?.id
    if (id === undefined || (!rt.isBotSession(id) && !rt.roomOf(id))) return
    void sendUserMentions(id, textOfContent(event.data?.content), `${id}:${event.seq ?? event.id ?? textOfContent(event.data?.content)}`)
      .catch(error => warn('flybot: user mention failed: %s', error))
  })

  // ---------------------------------------------------------------- UI endpoints
  const handlers = new Map()
  const api = {
    handle(name, fn) {
      if (handlers.has(name)) throw new Error(`flybot: api ${name} exists`)
      handlers.set(name, fn)
      return () => handlers.delete(name)
    },
  }
  async function endpoint(name, payload) {
    await rt.load()
    const body = payload ?? {}
    switch (name) {
      case 'bots': return Object.values(state.bots).map(view)
      case 'remote-members': return remoteMembers.list()
      case 'changes': return { seq: changeSeq, changes: changes.filter(change => change.seq > Number(body.since ?? 0)) }
      case 'approvals': return approvals.list(body)
      case 'decide': return approvals.decide(String(body.id ?? ''), body.decision, body)
      default: {
        const handler = handlers.get(name)
        if (handler === undefined) throw Object.assign(new Error(`Unknown FlyBot endpoint ${name}`), { code: 'bot/not-found' })
        return handler(body)
      }
    }
  }

  const build = (plugin) => {
    const fields = fieldsFor(plugin)
    return {
    version: FLYBOT_API_VERSION,
    plugin,
    scope: build,
    bot: {
      get: id => view(rt.botOf(id)),
      list: () => Object.values(state.bots).map(view),
      find: name => view(rt.findBot?.(name)),
      isRemote,
      of: sessionId => view(rt.botOf(rt.selfOf(sessionId))),
      create: spec => create({ plugin, ...spec }),
      setSystemPrompt,
      // Same object as flybot.fields.
      fields,
      send: Object.assign((msg) => send({ via: plugin, ...msg }), { use, list: send.list }),
    },
    fields,
    on: onFor(plugin),
    transports: { add: addTransport },
    remote: { publish: list => remoteMembers.publish(plugin, list), list: remoteMembers.list, get: remoteMembers.get },
    approvals,
    tools,
    api,
    outcomeOf: exchangeId => outcomes.get(exchangeId),
    }
  }
  const flybot = build(SHARED)
  Object.assign(rt, { flybot, flybotEndpoint: endpoint, flybotRemoteMembers: remoteMembers.list, flybotSendUserMentions: sendUserMentions })
}
