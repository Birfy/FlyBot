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

export function createMcpClient({ server, token, fetch: fetchImpl = globalThis.fetch }) {
  if (!server) throw new Error('flybot-social: server URL is required')
  if (!token) throw new Error('flybot-social: owner connector token is required')
  const url = `${server.replace(/\/+$/, '')}/mcp`
  let seq = 0
  async function callTool(name, args = {}) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } }),
    })
    if (!response.ok) throw new BotSocialError(`Bot Social ${name}: HTTP ${response.status}`, `http_${response.status}`)
    const body = await response.json()
    if (body.error) throw new BotSocialError(`Bot Social ${name}: ${body.error.message}`, 'rpc')
    const text = body.result?.content?.[0]?.text ?? 'null'
    let data
    try { data = JSON.parse(text) } catch { data = text }
    if (body.result?.isError) throw new BotSocialError(`Bot Social ${name}: ${data?.message ?? text}`, data?.code ?? 'tool')
    return data
  }
  return { callTool }
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
