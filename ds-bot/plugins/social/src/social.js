// The host half of flybot-social, written against the FlyBot API only.
//
// Model (FlyBot homes on Bot Social):
// - One home identity per FlyBot install (e.g. @danyang.home), made by the one-call
//   POST /v1/onboard/flybot on first start; the returned connector token is kept in
//   the credentials file (never in state.json).
// - Every local Bot is a member identity @<bot>.<home>, keys custodied by the server.
//   Bots are registered on start and on 'bot.created', revoked on 'bot.removed'.
// - Friendship is home-to-home: once a friend home is accepted, every local Bot can
//   message every Bot of that home, and those remote Bots show in the roster (grouped by
//   home, never in bot.list()).
// - Middleware 'social': remote targets must belong to a friend home; then approval:
//   the friend home's setting (config.approval.homes[home] / default), overridden per
//   local Bot by the field social.autoApprove[home]. 'hold' → FlyBot approval card.
// - Inbound: each member's server inbox is polled; messages reach that member's chat
//   as untrusted text from the remote Bot.
// - Backward compat: without a home, config.botId + token use the per-bot identity
//   (start_conversation / send_message) as before.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createMcpClient, untrustedText } from './mcp-client.js'

export const NS = 'social'
const REMOTE_TTL_MS = 30_000
const norm = handle => `@${String(handle ?? '').trim().replace(/^@+/, '').toLowerCase()}`
const slug = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'bot'

// One call to the server's FlyBot onboarding; returns { token, home } to keep.
export async function onboard({ server, displayName, webhookUrl, fetch: fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${server.replace(/\/+$/, '')}/v1/onboard/flybot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ display_name: displayName, ...(webhookUrl ? { webhook_url: webhookUrl } : {}) }),
  })
  if (!response.ok) throw new Error(`Bot Social onboarding failed: HTTP ${response.status}`)
  const body = await response.json()
  return { token: body.connector.token, home: { id: body.home.bot_id, handle: body.home.handle }, ownerId: body.owner_id, webhook: body.webhook ?? null }
}

export const readCredentials = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}
export const writeCredentials = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 })
  try { chmodSync(path, 0o600) } catch {}
}

export function createSocial(service, config = {}, { client: given, home: givenHome, now = Date.now, setInterval: every = globalThis.setInterval, clearInterval: clear = globalThis.clearInterval } = {}) {
  const flybot = service.scope(NS)
  const client = given ?? createMcpClient({ server: config.server, token: config.token ?? process.env.FLYBOT_SOCIAL_TOKEN, fetch: config.fetch })
  const home = givenHome ?? config.home
  const disposers = []
  const warn = (...args) => console.warn('flybot-social:', ...args)

  // ------------------------------------------------------------ members
  const memberOf = botId => flybot.fields.get(botId, 'member')
  async function register(bot) {
    if (!home || memberOf(bot.id)) return memberOf(bot.id)
    const member = await client.callTool('add_home_member', { home: home.id, name: slug(bot.name), display_name: bot.name })
    flybot.fields.set(bot.id, 'member', { bot_id: member.bot_id, handle: member.handle })
    return memberOf(bot.id)
  }
  async function registerAll() {
    for (const bot of flybot.bot.list()) await register(bot)
  }
  disposers.push(flybot.on('bot.created', bot => { void register(bot).catch(error => warn('register failed', error)) }))
  disposers.push(flybot.on('bot.removed', ({ bot }) => {
    const member = bot?.fields?.[NS]?.member
    if (home && member) void client.callTool('remove_home_member', { home: home.id, member: member.bot_id }).catch(error => warn('revoke failed', error))
  }))

  // ------------------------------------------------------------ remote roster
  let remote = { homes: [] }
  let fetchedAt = 0
  async function remoteBots({ fresh = false } = {}) {
    if (!fresh && now() - fetchedAt < REMOTE_TTL_MS) return remote
    if (home) {
      const result = await client.callTool('list_remote_bots', { home: home.id })
      remote = {
        homes: (result?.homes ?? []).map(entry => ({
          home: norm(entry.home.handle),
          name: entry.home.display_name,
          owner: entry.home.owner_display_name,
          bots: entry.bots.map(bot => ({ handle: norm(bot.handle), name: bot.display_name, home: norm(entry.home.handle), remote: true })),
        })),
      }
    } else {
      // Per-bot identity (legacy): each active friend is its own "home" of one Bot.
      const overview = await client.callTool('list_friends', config.botId ? { bot_id: config.botId } : {})
      remote = {
        homes: (overview?.friends ?? []).filter(item => item.status === 'active').map(item => ({
          home: norm(item.peer?.handle), name: item.peer?.display_name, owner: item.peer?.owner_display_name,
          bots: [{ handle: norm(item.peer?.handle), name: item.peer?.display_name, home: norm(item.peer?.handle), remote: true, conversationId: item.last_conversation?.status === 'active' ? item.last_conversation.conversation_id : undefined }],
        })),
      }
    }
    fetchedAt = now()
    // Friends' Bots become chat members (remote badge) through the FlyBot registry.
    flybot.remote?.publish(remote.homes.flatMap(entry => entry.bots.map(bot => ({ handle: bot.handle, name: bot.name, home: entry.home, homeName: entry.name, owner: entry.owner }))))
    return remote
  }
  const remoteBot = async handle => (await remoteBots()).homes.flatMap(entry => entry.bots).find(bot => bot.handle === norm(handle))

  // ------------------------------------------------------------ approval policy
  const approvalFor = (fromBotId, friendHome) => {
    const override = typeof fromBotId === 'string' ? flybot.fields.get(fromBotId, 'autoApprove')?.[friendHome] : undefined
    if (override === true) return 'auto'
    if (override === false) return 'hold'
    const homeSetting = config.approval?.homes?.[friendHome]
    if (homeSetting) return homeSetting
    if (config.requireApproval === false) return 'auto'
    return config.approval?.default ?? 'hold'
  }

  disposers.push(flybot.bot.send.use({
    name: 'social',
    async handle(msg) {
      if (msg.target?.remote !== true || (msg.to?.transport ?? 'bot-social') !== 'bot-social') return undefined
      const bot = await remoteBot(msg.target.handle)
      if (bot === undefined) return { action: 'deny', reason: `${msg.target.handle} is not a Bot of a friend on Bot Social` }
      if (approvalFor(msg.from, bot.home) === 'auto') return undefined
      return { action: 'hold', reason: `messages to ${bot.home}'s Bots need your approval` }
    },
  }))

  // ------------------------------------------------------------ transport
  disposers.push(flybot.transports.add('bot-social', {
    async send(msg) {
      const bot = await remoteBot(msg.target.handle)
      if (bot === undefined) throw new Error(`${msg.target.handle} is no longer reachable`)
      if (home) {
        const member = typeof msg.from === 'string' ? memberOf(msg.from) ?? await register(flybot.bot.get(msg.from)) : undefined
        if (!member) throw new Error('the sending Bot has no Bot Social identity')
        const sent = await client.callTool('send_as_member', { from_bot_id: member.bot_id, to: bot.handle, text: msg.text })
        return { exchangeId: sent?.message?.message_id ?? msg.exchangeId }
      }
      // Legacy per-bot identity.
      if (bot.conversationId) {
        try {
          const message = await client.callTool('send_message', { conversation_id: bot.conversationId, text: msg.text })
          return { exchangeId: message?.message_id ?? msg.exchangeId }
        } catch {}
      }
      const started = await client.callTool('start_conversation', { friend: bot.handle, text: msg.text, ...(config.botId ? { bot_id: config.botId } : {}) })
      return { exchangeId: started?.message?.message_id ?? msg.exchangeId }
    },
  }))

  // ------------------------------------------------------------ inbound
  const cursors = new Map()
  async function pollInbox() {
    const targets = home
      ? flybot.bot.list().filter(bot => memberOf(bot.id)).map(bot => ({ local: bot, botId: memberOf(bot.id).bot_id }))
      : [{ local: (config.localBot ? flybot.bot.find(config.localBot) : undefined) ?? flybot.bot.list().find(bot => bot.isMain), botId: config.botId }]
    let delivered = 0
    for (const { local, botId } of targets) {
      if (local === undefined) continue
      const key = botId ?? 'default'
      const result = await client.callTool('list_inbox', { ...(cursors.has(key) ? { since_cursor: cursors.get(key) } : {}), ...(botId ? { bot_id: botId } : {}) })
      if (result?.next_cursor !== undefined) cursors.set(key, result.next_cursor)
      for (const event of result?.events ?? []) {
        if (event.event_type !== 'message.received') continue
        const text = untrustedText(event.untrusted_content)
        if (!text) continue
        const handle = norm(event.from?.handle)
        await flybot.bot.send({
          from: { kind: 'remote', handle, home: event.from?.home_handle ? norm(event.from.home_handle) : undefined, name: `${event.from?.display_name ?? handle} (${handle}, Bot Social)` },
          to: local.id,
          text,
          meta: { conversationId: event.conversation_id ?? null },
        })
        delivered += 1
      }
    }
    return delivered
  }
  if (config.inboxPollMs > 0) {
    const timer = every(() => {
      void pollInbox().catch(() => {})
      if (now() - fetchedAt >= REMOTE_TTL_MS) void remoteBots({ fresh: true }).catch(() => {})
    }, config.inboxPollMs)
    disposers.push(() => clear(timer))
  }

  // ------------------------------------------------------------ model tools (every local Bot)
  disposers.push(flybot.tools.register({
    name: 'list_friend_bots',
    description: 'List Bots of the user\'s friends on Bot Social (other people\'s Bots), grouped by friend. Any of them can be messaged with message_friend_bot.',
    parameters: {},
    async execute() {
      const { homes } = await remoteBots({ fresh: true })
      if (homes.length === 0) return 'No friends\' Bots yet.'
      return homes.map(entry => `${entry.name ?? entry.home} (${entry.home}${entry.owner ? `, ${entry.owner}` : ''}):\n${entry.bots.map(bot => `- ${bot.handle} (${bot.name})`).join('\n') || '- no Bots'}`).join('\n')
    },
  }))
  disposers.push(flybot.tools.register({
    name: 'message_friend_bot',
    description: 'Send a message to a friend\'s Bot on Bot Social (another person\'s Bot). The user may need to approve it before it leaves; replies arrive later as new messages.',
    parameters: {
      to: { type: 'string', required: true, description: 'Handle from list_friend_bots, e.g. @coder.bob.home' },
      message: { type: 'string', required: true, description: 'Self-contained message; the other Bot cannot see this conversation' },
    },
    async execute(args, { botId }) {
      const to = norm(args.to)
      const result = await flybot.bot.send({ from: botId, to, text: String(args.message ?? '') })
      if (result.action === 'deny') throw new Error(`Not sent: ${result.reason}`)
      if (result.action === 'hold') return `Waiting for the user's approval before it goes to ${to}. Do not resend.`
      return `Sent to ${to}. A reply arrives later as a new message.`
    },
  }))

  // ------------------------------------------------------------ UI endpoints
  disposers.push(flybot.api.handle('social/remote-bots', async payload => remoteBots({ fresh: payload?.fresh === true })))
  disposers.push(flybot.api.handle('social/friends', async payload => (await remoteBots({ fresh: payload?.fresh === true })).homes.flatMap(entry => entry.bots)))
  disposers.push(flybot.api.handle('social/auto-approve', async ({ botId, home: friendHome, on }) => {
    flybot.fields.set(botId, 'autoApprove', { ...(flybot.fields.get(botId, 'autoApprove') ?? {}), [norm(friendHome)]: on === null ? undefined : Boolean(on) })
    return flybot.fields.get(botId, 'autoApprove')
  }))
  disposers.push(flybot.api.handle('social/poll', async () => ({ delivered: await pollInbox() })))

  return {
    home,
    registerAll,
    remoteBots,
    pollInbox,
    approvalFor,
    dispose() {
      for (const dispose of disposers.splice(0).reverse()) dispose?.()
    },
  }
}

// Plugin start: onboard once (credentials file), then build the social layer.
export async function startSocial(service, config = {}) {
  let credentials = config.credentialsPath ? readCredentials(config.credentialsPath) : undefined
  if (credentials === undefined && config.token === undefined && process.env.FLYBOT_SOCIAL_TOKEN === undefined && config.server && config.onboard !== false) {
    credentials = await onboard({ server: config.server, displayName: config.displayName ?? 'FlyBot', webhookUrl: config.webhookUrl, fetch: config.fetch })
    if (config.credentialsPath) writeCredentials(config.credentialsPath, credentials)
  }
  const social = createSocial(service, { ...config, token: credentials?.token ?? config.token, home: credentials?.home ?? config.home })
  if (social.home) await social.registerAll()
  // Friends' Bots show as chat members from the start.
  void social.remoteBots({ fresh: true }).catch(() => {})
  return social
}
