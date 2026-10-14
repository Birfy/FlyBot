import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The inbound friend conversation's display: trace lines, the thinking row, the remote speaker.
const { outputFiles } = await build({
  stdin: {
    contents: "export { stripTrace, previewOf } from './src/client/text.js'\nexport { remoteSpeaker } from './src/client/cells.js'",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const h = (type, props, ...children) => ({ type, props: { ...props, children } })
const react = { createElement: h, Fragment: Symbol('F'), useEffect() {}, useLayoutEffect() {}, useState: v => [v, () => {}], useMemo: f => f(), useRef: current => ({ current }) }
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports, document: { hidden: false }, navigator: { language: 'en' }, localStorage: { getItem: () => null, setItem() {} },
  require: (name) => {
    if (name === 'react') return react
    if (name === 'react-dom') return { createPortal: node => node }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: ({ text }) => text }
    throw new Error(`Unexpected platform module ${name}`)
  },
})
const { stripTrace, previewOf, remoteSpeaker } = module.exports

test('a reply opening with a delegation trace shows without it', () => {
  assert.equal(stripTrace('Chief → 助手\n\nHi Chief! Good to hear from you.'), 'Hi Chief! Good to hear from you.')
  assert.equal(stripTrace('user → 助手\nHi!'), 'Hi!')
  assert.equal(stripTrace('Chief → 程序员 → 后端\n\nDone.'), 'Done.')
  assert.equal(stripTrace('Use Settings → Models first'), 'Use Settings → Models first')
})

test('ordinary text that merely mentions an arrow is left alone', () => {
  for (const text of ['Hi! Step one → step two.', 'Settings → Models, then retry', 'Plain reply', 'a → b: see below\nmore']) {
    assert.equal(stripTrace(text), text)
  }
  assert.equal(stripTrace(undefined), undefined)
})

test('the sidebar preview drops the trace too', () => {
  const list = { byId: { s: { projectionValues: { turnOutline: [{ turn: 2, prompt: '', response: 'Chief → 助手\n\nHi Chief!' }] } } } }
  assert.equal(previewOf(list, 's'), 'Hi Chief!')
  const flat = { byId: { s: { projectionValues: { turnOutline: [{ turn: 1, prompt: '', response: 'Chief → 助手 Hi! Message received.' }] } } } }
  assert.equal(previewOf(flat, 's'), 'Hi! Message received.')
  const plain = { byId: { s: { projectionValues: { turnOutline: [{ turn: 1, prompt: '', response: 'Use Settings → Models first' }] } } } }
  assert.equal(previewOf(plain, 's'), 'Use Settings → Models first')
})

test("an inbound friend's message uses the friend's sidebar Bot (avatar, name), else a stable look from its handle", () => {
  const chat = { id: 'session-x', name: 'Chief', color: 'orange', shape: 'star', remote: { handle: '@chief.danyang.home' } }
  const roster = { bots: [chat], remoteBots: [{ handle: '@chief.danyang.home', name: 'Chief' }] }
  const got = remoteSpeaker({ remote: { handle: '@chief.danyang.home' } }, roster)
  assert.equal(got.bot, chat)
  assert.equal(got.name, 'Chief')
  assert.equal(got.chatId, 'session-x')
  const other = remoteSpeaker({ remote: { handle: '@x.home' }, senderName: 'X' }, { bots: [], remoteBots: [] })
  assert.equal(other.name, 'X')
  assert.notEqual(other.bot.color, 'gray')
  assert.equal(other.chatId, undefined)
})
