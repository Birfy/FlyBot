// Email to yourself (#355, first slice). With the owner's opt-in (Settings → General →
// Email me, off by default), the system notifications of #353 (one of your Bots finished or
// failed a turn, or waits for your approval) also reach your own address, open window or not:
// a short line each plus a link back into FlyBot, at most one email every five minutes. An
// email never carries chat or tool-call content and never approves anything; a reply to it is
// not read. A send that fails is noted in the diagnostics log (code only) and not retried.
//
// The server is the owner's own SMTP account, set in the environment (docs/docker.md):
//   FLYBOT_SMTP_URL   smtps://user:password@smtp.example.com (implicit TLS, port 465), or
//                     smtp://user:password@smtp.example.com:587 (STARTTLS, required with a password)
//   FLYBOT_EMAIL_TO   your own address; the only recipient there is
//   FLYBOT_URL        the address you open FlyBot at, for the link (default http://127.0.0.1:3080/)
// The password stays in the process: it is never saved, shown, logged or sent without TLS.
import net from 'node:net'
import tls from 'node:tls'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'

const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/
const DEFAULT_URL = 'http://127.0.0.1:3080/'
// One email gathers what happened within a minute; at most one email every five minutes.
const BATCH_MS = 60_000
const GAP_MS = 5 * 60_000
const LINES_SHOWN = 10
const TIMEOUT_MS = 30_000

// The SMTP settings from the environment, or undefined when email is not set up (or set up wrong:
// a bad value is never half-used).
export function emailConfig(env = process.env) {
  const to = env.FLYBOT_EMAIL_TO?.trim()
  const raw = env.FLYBOT_SMTP_URL?.trim()
  if (!to || !raw || !ADDRESS.test(to)) return undefined
  let url
  try { url = new URL(raw) } catch { return undefined }
  if ((url.protocol !== 'smtp:' && url.protocol !== 'smtps:') || !url.hostname) return undefined
  const secure = url.protocol === 'smtps:'
  let user, password
  try {
    user = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
  } catch { return undefined }
  let link = env.FLYBOT_URL?.trim() || DEFAULT_URL
  try { link = new URL(link).href } catch { link = DEFAULT_URL }
  if (!/^https?:/.test(link)) link = DEFAULT_URL
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port) || (secure ? 465 : 587),
    secure,
    ...(user ? { user, password } : {}),
    to,
    from: user && ADDRESS.test(user) ? user : to,
    link,
  }
}

// RFC 2047 for a header that is not plain ASCII; CR and LF never reach a header.
const header = text => {
  const flat = String(text).replace(/[\r\n]+/g, ' ').trim()
  return /^[\x20-\x7e]*$/.test(flat) ? flat : `=?UTF-8?B?${Buffer.from(flat).toString('base64')}?=`
}

export function message({ from, to, subject, text, now = new Date() }) {
  const body = Buffer.from(text.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n')
  return [
    `From: FlyBot <${from}>`,
    `To: <${to}>`,
    `Subject: ${header(subject)}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomUUID()}@flybot>`,
    'Auto-Submitted: auto-generated',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n')
}

const smtpError = (code) => Object.assign(new Error(`SMTP ${code}`), { code: `SMTP_${code}` })

// One email over SMTP. Errors carry a code only (`SMTP_<reply code>`, `SMTP_NO_TLS`,
// `SMTP_TIMEOUT`, `SMTP_CLOSED`, or the socket's code); the server's text is never kept.
export function sendMail(config, { subject, text }, { timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let socket
    let buffer = ''
    let lines = []
    let waiter
    let finished = false
    // Once the server took the message, a close (after QUIT, or instead of its answer) is no failure.
    let delivered = false
    const finish = (error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket?.destroy()
      if (error && !delivered) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(smtpError('TIMEOUT')), timeoutMs)
    // A reply is complete at its line with a space after the code.
    const onData = (chunk) => {
      buffer += chunk.toString('utf8')
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '')
        buffer = buffer.slice(end + 1)
        lines.push(line)
        if (/^\d{3}(?: |$)/.test(line)) {
          const reply = { code: Number(line.slice(0, 3)), lines }
          lines = []
          const next = waiter
          waiter = undefined
          next?.(reply)
        }
      }
    }
    const attach = (next) => {
      socket = next
      socket.on('data', onData)
      socket.on('error', error => finish(Object.assign(new Error('SMTP connection failed'), { code: error?.code ?? 'SMTP_CLOSED' })))
      socket.on('close', () => finish(smtpError('CLOSED')))
    }
    const read = () => new Promise((done) => { waiter = done })
    const expect = async (ok) => {
      const reply = await read()
      if (!ok.includes(reply.code)) throw smtpError(reply.code)
      return reply
    }
    const command = (line, ok) => {
      socket.write(`${line}\r\n`)
      return expect(ok)
    }
    const ehlo = async () => (await command(`EHLO ${hostname().replace(/[^\w.-]/g, '') || 'flybot'}`, [250])).lines.map(line => line.slice(4).toUpperCase())

    const run = async () => {
      await expect([220])
      let caps = await ehlo()
      let secure = config.secure
      if (!secure && caps.includes('STARTTLS')) {
        await command('STARTTLS', [220])
        const plain = socket
        plain.removeAllListeners('data')
        plain.removeAllListeners('close')
        plain.removeAllListeners('error')
        await new Promise((done, fail) => {
          const upgraded = tls.connect({ socket: plain, servername: net.isIP(config.host) ? undefined : config.host }, done)
          attach(upgraded)
          upgraded.once('error', fail)
        })
        secure = true
        caps = await ehlo()
      }
      if (config.user) {
        // A password never goes over a connection without TLS.
        if (!secure) throw smtpError('NO_TLS')
        const auth = caps.find(cap => cap.startsWith('AUTH')) ?? ''
        if (/\bPLAIN\b/.test(auth) || !/\bLOGIN\b/.test(auth)) {
          await command(`AUTH PLAIN ${Buffer.from(`\0${config.user}\0${config.password}`).toString('base64')}`, [235])
        } else {
          await command('AUTH LOGIN', [334])
          await command(Buffer.from(config.user).toString('base64'), [334])
          await command(Buffer.from(config.password).toString('base64'), [235])
        }
      }
      await command(`MAIL FROM:<${config.from}>`, [250])
      await command(`RCPT TO:<${config.to}>`, [250, 251])
      await command('DATA', [354])
      await command(`${message({ from: config.from, to: config.to, subject, text })}\r\n.`, [250])
      delivered = true
      await command('QUIT', [221]).catch(() => { /* delivered already */ })
    }

    const options = { host: config.host, port: config.port }
    attach(config.secure ? tls.connect({ ...options, servername: net.isIP(config.host) ? undefined : config.host }) : net.connect(options))
    run().then(() => finish(), finish)
  })
}

export function install(rt, { env = process.env, send = sendMail } = {}) {
  const config = emailConfig(env)
  let queue = []
  let timer
  let lastSent = -Infinity

  // Email only while one human uses this FlyBot: the address is theirs (set-prefs is blocked
  // with more members, authz.js).
  const on = () => config !== undefined && rt.state?.prefs?.email === true && Object.keys(rt.state.members ?? {}).length <= 1
  const emailView = () => (config ? { to: config.to } : null)
  const drop = () => {
    queue = []
    if (timer) clearTimeout(timer)
    timer = undefined
  }

  const lineOf = (event) => {
    const bot = rt.botOf(event.botId)
    const name = bot?.name ?? 'A Bot'
    const room = event.roomId ? rt.roomOf(event.roomId)?.name : undefined
    const what = event.kind === 'approval' ? `${name} is waiting for your approval`
      : event.kind === 'failed' ? `${name} failed: ${event.failed}` : `${name} finished`
    return `- ${what}${room ? ` (${room})` : ''}`
  }

  const flush = async () => {
    timer = undefined
    // Approvals already answered are no news.
    const open = new Set((rt.approvalsView?.() ?? []).map(entry => entry.id))
    const events = queue.filter(event => event.kind !== 'approval' || open.has(event.id))
    queue = []
    if (!on() || events.length === 0) return
    lastSent = Date.now()
    const lines = events.slice(0, LINES_SHOWN).map(lineOf)
    if (events.length > LINES_SHOWN) lines.push(`- and ${events.length - LINES_SHOWN} more`)
    const subject = events.length === 1 ? `FlyBot: ${lineOf(events[0]).slice(2)}` : `FlyBot: ${events.length} updates from your Bots`
    const text = [
      ...lines,
      '',
      `Open FlyBot: ${config.link}`,
      '',
      'Approve or reject only in FlyBot. Replies to this email are not read.',
      'Turn these emails off in FlyBot: Settings > General > Email me.',
    ].join('\n')
    try {
      await send(config, { subject, text })
    } catch (error) {
      rt.warn(`ds-bot: the email to yourself was not sent (${typeof error?.code === 'string' ? error.code : 'failed'})`)
    }
  }

  // A notification of #353 (approval waiting, turn finished or failed) of one of the owner's own
  // Bots. Queued only while the switch is on; switching it off drops the queue at once.
  const noticeOffApp = (kind, entry) => {
    if (!on()) return drop()
    const bot = rt.botOf(entry?.botId)
    if (bot === undefined || bot.remote !== undefined) return
    queue.push({ kind, id: entry.id, botId: entry.botId, roomId: entry.roomId, failed: entry.failed })
    if (timer) return
    timer = setTimeout(() => { flush().catch(() => { /* logged in flush */ }) }, Math.max(BATCH_MS, lastSent + GAP_MS - Date.now()))
    timer.unref?.()
  }

  // Off: whatever waits to be sent is dropped.
  const emailSwitched = (value) => {
    if (!value) drop()
  }

  Object.assign(rt, { emailView, noticeOffApp, emailSwitched, emailConfigured: () => config !== undefined })
}
