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
