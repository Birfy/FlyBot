// The FlyBot slot registry, free of React so the "@" menu and tests can use it.
// See flybot-slots.js for what each slot carries.
export const SLOTS = ['flybot.sidebar.section', 'flybot.composer.mention', 'flybot.bot.details', 'flybot.approvals']

export function createRegistry() {
  const entries = new Map(SLOTS.map(name => [name, []]))
  const listeners = new Set()
  let version = 0
  const changed = () => {
    version += 1
    for (const fn of [...listeners]) fn()
  }
  return {
    register(name, entry) {
      if (!entries.has(name)) throw new Error(`flybot: unknown slot ${name}`)
      if (typeof entry?.id !== 'string') throw new Error('flybot: a slot entry needs an id')
      const list = entries.get(name).filter(item => item.id !== entry.id)
      const item = { order: 0, ...entry }
      list.push(item)
      list.sort((a, b) => a.order - b.order)
      entries.set(name, list)
      changed()
      return () => {
        entries.set(name, entries.get(name).filter(other => other !== item))
        changed()
      }
    },
    entries: name => entries.get(name) ?? [],
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    version: () => version,
  }
}

export function registry() {
  const root = globalThis
  root.__flybot__ ??= { slots: createRegistry() }
  return root.__flybot__.slots
}

// Extra "@" rows from plugins (remote Bots and the like), after the team's own Bots.
export async function mentionCandidates(query, context) {
  const rows = []
  for (const entry of registry().entries('flybot.composer.mention')) {
    try {
      for (const row of (await entry.candidates(query, { ...context, call: globalThis.__flybot__?.call })) ?? []) rows.push({ ...row, source: entry.id })
    } catch (error) {
      console.error(`flybot: ${entry.id} mention rows failed`, error)
    }
  }
  return rows
}

const CHANGES_POLL_MS = 3000

// The browser `flybot` service (ctx.flybot in client plugins): the team's Bots with
// their fields, field change events (polled from the host), slots, and host calls.
export function createClientApi({ call: callFn, registry: slots = registry, every = setInterval, clear = clearInterval }) {
  const listeners = new Set()
  let since
  let timer
  const poll = async () => {
    const first = since === undefined
    try {
      const { seq, changes } = await callFn('changes', { since: since ?? 0 })
      // The first poll only learns where the log stands.
      const fresh = first ? [] : changes.filter(change => change.seq > (since ?? 0))
      since = Math.max(since ?? 0, seq)
      for (const change of fresh) {
        const { seq: _seq, ...event } = change
        for (const fn of [...listeners]) fn(event)
      }
    } catch {}
  }
  return {
    bots: () => callFn('bots'),
    fields: {
      on(event, fn) {
        if (event !== 'change') throw new Error(`flybot: unknown event ${event}`)
        listeners.add(fn)
        if (timer === undefined) {
          void poll()
          timer = every(poll, CHANGES_POLL_MS)
        }
        return () => {
          listeners.delete(fn)
          if (listeners.size === 0 && timer !== undefined) {
            clear(timer)
            timer = undefined
          }
        }
      },
    },
    slots: slots(),
    call: callFn,
    poll,
  }
}

// ---------------------------------------------------------------- remote members
// Friends' remote Bots (roster.remoteBots, published by plugins such as social). They are
// chat members with a remote badge, never team Bots.
export function remoteMembers(roster) {
  return Array.isArray(roster?.remoteBots) ? roster.remoteBots.filter(bot => typeof bot?.handle === 'string') : []
}

// "@query" rows for remote members: picking one inserts "@handle ", which the host sends
// through bot.send (so the social plugin's approval still applies).
export function remoteMentionRows(roster, query = '') {
  const needle = String(query).trim().toLowerCase().replace(/^@/, '')
  return remoteMembers(roster)
    .filter(bot => bot.handle.toLowerCase().includes(needle) || String(bot.name ?? '').toLowerCase().includes(needle))
    .map(bot => ({ remote: bot, text: `${bot.handle} ` }))
}

// Remote members grouped by their home, for the sidebar.
export function remoteMembersByHome(roster) {
  const homes = new Map()
  for (const bot of remoteMembers(roster)) {
    const key = bot.home ?? bot.handle
    if (!homes.has(key)) homes.set(key, { home: key, name: bot.homeName ?? bot.owner ?? key, bots: [] })
    homes.get(key).bots.push(bot)
  }
  return [...homes.values()]
}

// The words of a remote message as the chat shows them: the text inside its
// untrusted-message fence (the Bot still reads it fenced, as data, never as instructions).
export function remoteMessageText(text) {
  const value = String(text ?? '')
  const match = value.match(/<untrusted-message from="[^"]*">\n?([\s\S]*?)\n?<\/untrusted-message>/)
  return match ? match[1] : value
}
