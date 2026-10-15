// A minimal client for a Bot Social server's owner MCP endpoint (POST <server>/mcp,
// stateless Streamable HTTP, JSON responses), authenticated by an owner connector token.
// Only tools/call is used; see bot-social src/owner-mcp.ts for the tool set.

const UNTRUSTED = /^[\s\S]*?\n([\s\S]*)\n[^\n]*$/

export class BotSocialError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

export const CALL_TIMEOUT_MS = 30_000

export function createMcpClient({ server, token, fetch: fetchImpl = globalThis.fetch, timeoutMs = CALL_TIMEOUT_MS }) {
  if (!server) throw new Error('flybot-social: server URL is required')
  if (!token) throw new Error('flybot-social: owner connector token is required')
  const url = `${server.replace(/\/+$/, '')}/mcp`
  let seq = 0
  async function callTool(name, args = {}) {
    // Every call has a deadline: a hung server is an error, never a stall.
    const signal = AbortSignal.timeout(timeoutMs)
    let response
    let body
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
          'authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } }),
        signal,
      })
      if (!response.ok) throw new BotSocialError(`Bot Social ${name}: HTTP ${response.status}`, `http_${response.status}`)
      body = parseBody(await response.text(), response.headers?.get?.('content-type') ?? '')
    } catch (error) {
      if (error instanceof BotSocialError) throw error
      if (signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new BotSocialError(`Bot Social ${name}: no answer in ${Math.round(timeoutMs / 1000)}s`, 'timeout')
      throw error
    }
    if (body.error) throw new BotSocialError(`Bot Social ${name}: ${body.error.message}`, 'rpc')
    const text = body.result?.content?.[0]?.text ?? 'null'
    let data
    try { data = JSON.parse(text) } catch { data = text }
    if (body.result?.isError) throw new BotSocialError(`Bot Social ${name}: ${data?.message ?? text}`, data?.code ?? 'tool')
    return data
  }
  return { callTool }
}

// A JSON body, or a Server-Sent Events stream whose last `data:` line is the JSON-RPC answer.
function parseBody(text, type) {
  if (/text\/event-stream/i.test(type) || /^(event|data|id):/m.test(text.trimStart().slice(0, 6))) {
    const data = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(Boolean)
    for (const line of data.reverse()) {
      try { const value = JSON.parse(line); if (value && (value.result !== undefined || value.error !== undefined)) return value } catch {}
    }
    throw new BotSocialError('Bot Social: the event stream had no answer', 'sse')
  }
  return JSON.parse(text)
}

function isUnknownTool(error) {
  const text = String(error?.message ?? error ?? '')
  const code = String(error?.code ?? '')
  return code === 'unknown' || /unknown tool|no tool|not found|method not found|unrecognized/i.test(text)
}

function asList(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.grants)) return value.grants
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(value?.friends)) return value.friends
  return []
}

export function normalizeGrant(item) {
  if (!item || typeof item !== 'object') return undefined
  const grantee = item.grantee ?? item.peer?.handle ?? item.handle ?? item.home
  if (!grantee) return undefined
  const id = item.id ?? item.grant_id ?? item.relationship_id ?? item.relationshipId
  return {
    ...(id ? { id: String(id) } : {}),
    grantee: String(grantee),
    ...(item.name || item.peer?.display_name || item.display_name ? { name: String(item.name ?? item.peer?.display_name ?? item.display_name) } : {}),
    ...(item.relationship_id || item.relationshipId ? { relationshipId: String(item.relationship_id ?? item.relationshipId) } : {}),
    ...(item.room_id || item.roomId ? { roomId: String(item.room_id ?? item.roomId) } : {}),
  }
}

export function normalizeGrants(value) {
  return asList(value).map(normalizeGrant).filter(Boolean)
}

// Owner MCP + REST grant/invite helpers. Named methods so social.js never builds
// URLs or tool names inline; a later server can add list_grants / revoke_grant
// without touching the plugin's grant bookkeeping.
export function createSocialApi({ server, token, fetch: fetchImpl = globalThis.fetch, timeoutMs = CALL_TIMEOUT_MS, client } = {}) {
  const mcp = client ?? createMcpClient({ server, token, fetch: fetchImpl, timeoutMs })
  const base = String(server ?? '').replace(/\/+$/, '')

  async function rest(method, path, body) {
    if (!base) throw new BotSocialError(`Bot Social ${method} ${path}: no server URL`, 'no_server')
    if (!token) throw new BotSocialError(`Bot Social ${method} ${path}: no token`, 'no_token')
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const text = await response.text()
    let data
    try { data = text ? JSON.parse(text) : {} } catch { data = { message: text } }
    if (!response.ok) throw new BotSocialError(`Bot Social ${method} ${path}: HTTP ${response.status}`, `http_${response.status}`)
    return data
  }

  async function tryTool(name, args, fallback) {
    try {
      return await mcp.callTool(name, args)
    } catch (error) {
      if (typeof fallback === 'function' && isUnknownTool(error)) return fallback(error)
      throw error
    }
  }

  async function listGrants({ botId, relationshipId } = {}) {
    const args = {
      ...(botId ? { bot_id: botId } : {}),
      ...(relationshipId ? { relationship_id: relationshipId } : {}),
    }
    return normalizeGrants(await tryTool('list_grants', args, async () => {
      if (relationshipId && base) {
        try { return await rest('GET', `/v1/relationships/${encodeURIComponent(relationshipId)}/grants`) } catch { /* derive */ }
      }
      const overview = await mcp.callTool('list_friends', botId ? { bot_id: botId } : {})
      return (overview?.friends ?? []).filter(item => item.status === 'active' || item.status === undefined)
    }))
  }

  async function revokeGrant({ grantId, relationshipId, botId } = {}) {
    const args = {
      ...(grantId ? { grant_id: grantId } : {}),
      ...(relationshipId ? { relationship_id: relationshipId } : {}),
      ...(botId ? { bot_id: botId } : {}),
    }
    return tryTool('revoke_grant', args, async () => {
      if (grantId && base) {
        try { return await rest('DELETE', `/v1/grants/${encodeURIComponent(grantId)}`) } catch { /* next */ }
      }
      if (relationshipId && base) {
        const suffix = grantId ? `/${encodeURIComponent(grantId)}` : ''
        try { return await rest('DELETE', `/v1/relationships/${encodeURIComponent(relationshipId)}/grants${suffix}`) } catch { /* next */ }
      }
      if (!relationshipId) throw new BotSocialError('Bot Social revoke_grant: which grant?', 'invalid')
      return mcp.callTool('remove_friend', { relationship_id: relationshipId })
    })
  }

  return {
    callTool: (name, args) => mcp.callTool(name, args),
    rest,
    listRemoteBots: args => mcp.callTool('list_remote_bots', args),
    listFriends: args => mcp.callTool('list_friends', args ?? {}),
    createInvite: args => mcp.callTool('create_invite', args),
    joinInvite: args => mcp.callTool('join_invite', args),
    listInvites: args => mcp.callTool('list_invites', args ?? {}),
    revokeInvite: args => mcp.callTool('revoke_invite', args),
    respondFriendRequest: args => mcp.callTool('respond_friend_request', args),
    removeFriend: args => mcp.callTool('remove_friend', args),
    listApprovals: args => mcp.callTool('list_approvals', args),
    decideApproval: args => mcp.callTool('decide_approval', args),
    setAutoApprove: args => mcp.callTool('set_auto_approve', args),
    addHomeMember: args => mcp.callTool('add_home_member', args),
    removeHomeMember: args => mcp.callTool('remove_home_member', args),
    listInbox: args => mcp.callTool('list_inbox', args),
    sendAsMember: args => mcp.callTool('send_as_member', args),
    listGrants,
    revokeGrant,
  }
}

// The server fences peer text as a string between markers; this returns the text alone.
export function untrustedText(value) {
  if (typeof value !== 'string') return String(value?.text ?? '')
  const inner = value.match(UNTRUSTED)?.[1] ?? value
  try {
    return String(JSON.parse(inner)?.text ?? inner)
  } catch {
    return inner
  }
}
