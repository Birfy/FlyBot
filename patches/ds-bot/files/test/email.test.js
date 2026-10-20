// Email to yourself (#355): the SMTP settings, the message, the SMTP exchange, and which
// notifications become an email when.
import assert from 'node:assert/strict'
import net from 'node:net'
import { test } from 'node:test'
import { emailConfig, install, message, sendMail } from '../src/host/email.js'
import { install as installApprovals } from '../src/host/approvals.js'

test('the settings come from the environment; anything missing or wrong means no email', () => {
  assert.deepEqual(emailConfig({ FLYBOT_SMTP_URL: 'smtps://me%40mail.example:p%40ss@smtp.mail.example', FLYBOT_EMAIL_TO: 'me@mail.example' }), {
    host: 'smtp.mail.example', port: 465, secure: true, user: 'me@mail.example', password: 'p@ss', to: 'me@mail.example', from: 'me@mail.example', link: 'http://127.0.0.1:3080/',
  })
  assert.deepEqual(emailConfig({ FLYBOT_SMTP_URL: 'smtp://relay.lan', FLYBOT_EMAIL_TO: 'me@mail.example', FLYBOT_URL: 'https://flybot.example.com' }), {
    host: 'relay.lan', port: 587, secure: false, to: 'me@mail.example', from: 'me@mail.example', link: 'https://flybot.example.com/',
  })
  assert.equal(emailConfig({ FLYBOT_SMTP_URL: 'smtp://user:pw@smtp.example.com:2525', FLYBOT_EMAIL_TO: 'me@mail.example' }).from, 'me@mail.example')
  assert.equal(emailConfig({ FLYBOT_SMTP_URL: 'smtp://relay.lan', FLYBOT_EMAIL_TO: 'me@mail.example', FLYBOT_URL: 'javascript:alert(1)' }).link, 'http://127.0.0.1:3080/')
  for (const env of [
    {},
    { FLYBOT_SMTP_URL: 'smtp://relay.lan' },
    { FLYBOT_EMAIL_TO: 'me@mail.example' },
    { FLYBOT_SMTP_URL: 'https://relay.lan', FLYBOT_EMAIL_TO: 'me@mail.example' },
    { FLYBOT_SMTP_URL: 'not a url', FLYBOT_EMAIL_TO: 'me@mail.example' },
    { FLYBOT_SMTP_URL: 'smtp://relay.lan', FLYBOT_EMAIL_TO: 'me@mail.example\r\nBcc: other@x.example' },
    { FLYBOT_SMTP_URL: 'smtp://relay.lan', FLYBOT_EMAIL_TO: 'me, other@x.example' },
  ]) assert.equal(emailConfig(env), undefined, JSON.stringify(env))
})

test('a message is plain UTF-8 text with a safe subject', () => {
  const raw = message({ from: 'me@mail.example', to: 'me@mail.example', subject: '写手 finished\r\nBcc: x@y.example', text: 'line one\nline two', now: new Date(0) })
  const [head, body] = raw.split('\r\n\r\n')
  assert.match(head, /^From: FlyBot <me@mail\.example>\r\nTo: <me@mail\.example>\r\nSubject: =\?UTF-8\?B\?[\w+/=]+\?=\r\n/)
  assert.equal(Buffer.from(head.match(/B\?([\w+/=]+)\?=/)[1], 'base64').toString(), '写手 finished Bcc: x@y.example')
  assert.doesNotMatch(head, /^Bcc:/m)
  assert.match(head, /Auto-Submitted: auto-generated/)
  assert.equal(Buffer.from(body, 'base64').toString(), 'line one\r\nline two')
  assert.match(message({ from: 'a@b.example', to: 'a@b.example', subject: 'Plain', text: '' }), /\r\nSubject: Plain\r\n/)
})

// A minimal SMTP server: no STARTTLS, optional AUTH, a reply code per command on request.
function smtpServer({ auth = false, fail = {} } = {}) {
  const seen = []
  const mails = []
  const server = net.createServer((socket) => {
    let data = false
    let mail = ''
    let buffer = ''
    socket.write('220 test ESMTP\r\n')
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      let end
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (data) {
          if (line === '.') {
            data = false
            mails.push(mail)
            socket.write('250 queued\r\n')
          } else mail += `${line}\r\n`
          continue
        }
        seen.push(line)
        const verb = line.split(/[ :]/)[0].toUpperCase()
        if (fail[verb]) socket.write(`${fail[verb]} no\r\n`)
        else if (verb === 'EHLO') socket.write(`250-test\r\n${auth ? '250-AUTH PLAIN LOGIN\r\n' : ''}250 8BITMIME\r\n`)
        else if (verb === 'DATA') { data = true; socket.write('354 go\r\n') }
        else if (verb === 'QUIT') { socket.end('221 bye\r\n') }
        else socket.write('250 ok\r\n')
      }
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, seen, mails, close: () => server.close() })))
}

test('an email goes through a relay that needs no password', async (t) => {
  const smtp = await smtpServer()
  t.after(smtp.close)
  await sendMail({ host: '127.0.0.1', port: smtp.port, secure: false, to: 'me@mail.example', from: 'me@mail.example' }, { subject: 'FlyBot: Coder finished', text: '- Coder finished' })
  assert.deepEqual(smtp.seen.slice(1), ['MAIL FROM:<me@mail.example>', 'RCPT TO:<me@mail.example>', 'DATA', 'QUIT'])
  assert.match(smtp.seen[0], /^EHLO \S+$/)
  assert.equal(smtp.mails.length, 1)
  assert.match(smtp.mails[0], /Subject: FlyBot: Coder finished/)
})

test('a password never goes over a connection without TLS, and a refusal keeps only its code', async (t) => {
  const smtp = await smtpServer({ auth: true })
  t.after(smtp.close)
  await assert.rejects(
    sendMail({ host: '127.0.0.1', port: smtp.port, secure: false, user: 'me', password: 'hunter2', to: 'me@mail.example', from: 'me@mail.example' }, { subject: 's', text: 't' }),
    error => error.code === 'SMTP_NO_TLS' && !error.message.includes('hunter2'),
  )
  assert.equal(smtp.seen.some(line => /AUTH|aHVudGVyMg|hunter2/.test(line)), false)
  assert.equal(smtp.mails.length, 0)

  const refusing = await smtpServer({ fail: { RCPT: 550 } })
  t.after(refusing.close)
  await assert.rejects(
    sendMail({ host: '127.0.0.1', port: refusing.port, secure: false, to: 'me@mail.example', from: 'me@mail.example' }, { subject: 's', text: 't' }),
    error => error.code === 'SMTP_550',
  )
})

// The notifier on a stand-in runtime, with mocked timers and a recording sender.
function notifier(t, { prefs = { email: true }, members = {}, env = { FLYBOT_SMTP_URL: 'smtp://relay.lan', FLYBOT_EMAIL_TO: 'me@mail.example', FLYBOT_URL: 'https://flybot.example.com/' }, send } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  const sent = []
  const warnings = []
  const open = []
  const rt = {
    state: { prefs, members },
    botOf: id => ({ b: { id: 'b', name: 'Coder' }, f: { id: 'f', name: 'Pal', remote: { handle: '@pal' } } })[id],
    roomOf: id => ({ r1: { id: 'r1', name: 'Ops' } })[id],
    approvalsView: () => open.map(id => ({ id })),
    warn: line => warnings.push(line),
  }
  install(rt, { env, send: send ?? (async (config, mail) => { sent.push({ config, ...mail }) }) })
  const advance = async (ms) => {
    t.mock.timers.tick(ms)
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }
  return { rt, sent, warnings, open, advance, notice: rt.noticeOffApp }
}

test('switched on, a minute of news from my own Bots becomes one email with a link back and nothing to act on', async (t) => {
  const box = notifier(t)
  assert.deepEqual(box.rt.emailView(), { to: 'me@mail.example' })
  box.open.push('a1')
  box.notice('finished', { id: 'e1', botId: 'b', sessionId: 'b' })
  box.notice('failed', { id: 'e2', botId: 'b', roomId: 'r1', failed: 'upstream busy' })
  box.notice('approval', { id: 'a1', botId: 'b', roomId: 'r1', tool: 'pwsh', reason: 'rm -rf /tmp/x', detail: { code: 'rm -rf /tmp/x' } })
  box.notice('approval', { id: 'a2', botId: 'b', sessionId: 'b', tool: 'pwsh' })
  box.notice('finished', { id: 'e3', botId: 'f', sessionId: 'f' })
  await box.advance(59_000)
  assert.equal(box.sent.length, 0)
  await box.advance(1_000)
  assert.equal(box.sent.length, 1)
  const [mail] = box.sent
  assert.equal(mail.subject, 'FlyBot: 3 updates from your Bots')
  assert.equal(mail.text, [
    '- Coder finished',
    '- Coder failed: upstream busy (Ops)',
    '- Coder is waiting for your approval (Ops)',
    '',
    'Open FlyBot: https://flybot.example.com/',
    '',
    'Approve or reject only in FlyBot. Replies to this email are not read.',
    'Turn these emails off in FlyBot: Settings > General > Email me.',
  ].join('\n'))
  assert.equal(mail.config.to, 'me@mail.example')
  assert.doesNotMatch(mail.text, /pwsh|rm -rf/)
})

test('one email every five minutes at most; a single event names itself in the subject', async (t) => {
  const box = notifier(t)
  box.notice('finished', { id: 'e1', botId: 'b', sessionId: 'b' })
  await box.advance(60_000)
  box.notice('finished', { id: 'e2', botId: 'b', sessionId: 'b' })
  await box.advance(4 * 60_000)
  assert.equal(box.sent.length, 1)
  assert.equal(box.sent[0].subject, 'FlyBot: Coder finished')
  await box.advance(60_000)
  assert.equal(box.sent.length, 2)
})

test('off by default, off with more than one member, off without settings, and switching off drops what waits', async (t) => {
  for (const options of [{ prefs: {} }, { members: { 'owner-1': {}, 'owner-2': {} } }, { env: {} }]) {
    const box = notifier(t, options)
    box.notice('finished', { id: 'e1', botId: 'b', sessionId: 'b' })
    await box.advance(10 * 60_000)
    assert.equal(box.sent.length, 0, JSON.stringify(options))
    t.mock.timers.reset()
  }
  assert.equal(notifier(t, { env: {} }).rt.emailView(), null)
  t.mock.timers.reset()

  const box = notifier(t)
  box.notice('finished', { id: 'e1', botId: 'b', sessionId: 'b' })
  box.rt.emailSwitched(false)
  await box.advance(10 * 60_000)
  assert.equal(box.sent.length, 0)
})

test('approvals answered before the email goes are left out, and a failed send is noted by its code', async (t) => {
  const box = notifier(t)
  box.notice('approval', { id: 'a1', botId: 'b', sessionId: 'b' })
  await box.advance(60_000)
  assert.equal(box.sent.length, 0)
  t.mock.timers.reset()

  const failing = notifier(t, {
    env: { FLYBOT_SMTP_URL: 'smtp://u:secret@relay.lan', FLYBOT_EMAIL_TO: 'me@mail.example' },
    send: async () => { throw Object.assign(new Error('535 bad secret'), { code: 'SMTP_535' }) },
  })
  failing.notice('finished', { id: 'e1', botId: 'b', sessionId: 'b' })
  await failing.advance(60_000)
  assert.deepEqual(failing.warnings, ['ds-bot: the email to yourself was not sent (SMTP_535)'])
})

test('an approval that starts waiting reaches the notifier', async () => {
  let middleware
  const offApp = []
  installApprovals({
    ctx: { on: (name, fn) => { if (name === 'approval/request') middleware = fn } },
    groupOwners: new Map(),
    chatOwners: new Map([['s1', 'b']]),
    noticeOffApp: (kind, entry) => offApp.push([kind, entry.botId, entry.sessionId]),
  })
  assert.equal(await middleware({ agent: { id: 's1' }, toolName: 'pwsh' }, () => 'allowed'), 'allowed')
  assert.deepEqual(offApp, [['approval', 'b', 's1']])
})
