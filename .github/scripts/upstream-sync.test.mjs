// upstream-sync (#815): the read-only check that says whether the fork's main is on upstream's main
// and whether the ruleset that protects it came back. Each case pins one exit code from the issue's
// acceptance list, and the fake transport records every request so "read-only" is asserted, not
// promised.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, DEFAULTS } from './upstream-sync.mjs'

const UP = '6f9b60c7f9f2ffd07fa1387eece36756fbd49dbb'
const FORK = 'f20cfa37f9f2ffd07fa1387eece36756fbd49dbb'
const RULESET = { enforcement: 'active', bypass_actors: [], current_user_can_bypass: 'never' }

// A transport that answers the four reads this script makes and refuses anything else, so a request
// the script should not make fails the test instead of reaching GitHub.
function transport({ upstreamSha = UP, forkSha = FORK, aheadBy = 0, behindBy = 0, status = 'identical', ruleset = RULESET, rulesetStatus = 200 } = {}) {
  const seen = []
  const json = (body) => ({ status: 200, text: async () => JSON.stringify(body) })
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method ?? 'GET' })
    if (url.endsWith(`/repos/${DEFAULTS.upstream}/git/ref/heads/main`)) return json({ object: { sha: upstreamSha } })
    if (url.endsWith(`/repos/${DEFAULTS.fork}/git/ref/heads/main`)) return json({ object: { sha: forkSha } })
    if (url.includes(`/repos/${DEFAULTS.upstream}/compare/`)) return json({ ahead_by: aheadBy, behind_by: behindBy, status })
    if (url.endsWith(`/repos/${DEFAULTS.upstream}/rulesets/${DEFAULTS.rulesetId}`)) {
      if (rulesetStatus !== 200) return { status: rulesetStatus, text: async () => JSON.stringify({ message: 'Not Found' }) }
      return json({ id: Number(DEFAULTS.rulesetId), ...ruleset })
    }
    throw new Error(`unexpected request: ${url}`)
  }
  return { fetchImpl, seen }
}

const run = async (options) => {
  const { fetchImpl, seen } = transport(options)
  const lines = []
  const code = await check({ fetchImpl, env: { GITHUB_TOKEN: 'test-token' }, log: (line) => lines.push(String(line)), argv: ['--check'] })
  return { code, out: lines.join('\n'), seen }
}

test('equal mains and an active ruleset with no bypass actor: exit 0', async () => {
  const { code, out } = await run({ forkSha: UP })
  assert.equal(code, 0)
  assert.match(out, new RegExp(`upstream main : ${UP}`))
  assert.match(out, new RegExp(`fork main     : ${UP}`))
  assert.match(out, /CHECK ok/)
})

test('the numbers are printed, not only the verdict', async () => {
  // #815 acceptance 8: ahead_by/behind_by have to be readable from the output. A run that reports
  // only "not equal" cannot say how far the fast-forward would move upstream.
  const { code, out } = await run({ forkSha: 'a'.repeat(40), aheadBy: 7, behindBy: 0, status: 'ahead' })
  assert.notEqual(code, 0)
  assert.match(out, /ahead_by: 7 {2}behind_by: 0 {2}status: ahead/)
})

test('a fork behind upstream is a failure: exit nonzero', async () => {
  const { code, out } = await run({ forkSha: 'b'.repeat(40), aheadBy: 0, behindBy: 2, status: 'behind' })
  assert.notEqual(code, 0)
  assert.match(out, /behind_by: 2/)
  assert.match(out, /CHECK FAILED/)
})

test('a ruleset that is not active is a failure: exit nonzero', async () => {
  const { code, out } = await run({ ruleset: { ...RULESET, enforcement: 'disabled' } })
  assert.notEqual(code, 0)
  assert.match(out, /enforcement=disabled/)
  assert.match(out, /not active/)
})

test('a ruleset with a bypass actor is a failure: exit nonzero', async () => {
  const { code, out } = await run({ ruleset: { ...RULESET, bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole' }] } })
  assert.notEqual(code, 0)
  assert.match(out, /bypass_actors=\["RepositoryRole:5"\]/)
  assert.match(out, /bypass actors/)
})

test('a ruleset read that answers 404 names the id and fails: exit nonzero', async () => {
  const { code, out } = await run({ rulesetStatus: 404 })
  assert.notEqual(code, 0)
  assert.match(out, new RegExp(`ruleset ${DEFAULTS.rulesetId} cannot be read: HTTP 404`))
  assert.match(out, /CHECK FAILED/)
})

test('every request is a GET, and nothing goes anywhere but api.github.com', async () => {
  // #815 kill condition: automation that can push while the ruleset is off. This check never writes,
  // and the assertion is the transport's record rather than a promise in a comment.
  const { code, seen } = await run({ forkSha: UP })
  assert.equal(code, 0)
  assert.equal(seen.length, 4)
  for (const { url, method } of seen) {
    assert.equal(method, 'GET', `${method} ${url}`)
    assert.ok(url.startsWith('https://api.github.com/'), url)
  }
})

test('no token is a usage error, not a pass', async () => {
  const { fetchImpl } = transport({})
  const lines = []
  const code = await check({ fetchImpl, env: {}, log: (line) => lines.push(String(line)), argv: ['--check'] })
  assert.equal(code, 2)
  assert.match(lines.join('\n'), /no GITHUB_TOKEN/)
})

test('without --check it prints usage and exits 2', async () => {
  const { fetchImpl, seen } = transport({})
  const lines = []
  const code = await check({ fetchImpl, env: { GITHUB_TOKEN: 't' }, log: (line) => lines.push(String(line)), argv: [] })
  assert.equal(code, 2)
  assert.equal(seen.length, 0)
  assert.match(lines.join('\n'), /usage:/)
})
