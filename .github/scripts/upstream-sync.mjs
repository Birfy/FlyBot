// Is the fork's `main` on upstream's `main`, and is upstream's `main` ruleset still on? (#815)
//
//   node .github/scripts/upstream-sync.mjs --check
//
// Read-only by construction: every request is a `GET`, and nothing here writes to either repository.
// The fast-forward itself is an agent step in [docs/release-runbook.md](../../docs/release-runbook.md);
// this answers the two questions that step needs answered before it runs and after it restores —
// "would the push be a fast-forward?" and "did the ruleset come back exactly as it was?".
//
// Exit 0 only when both `main` refs are the same commit and the ruleset is `active` with an empty
// `bypass_actors`. Anything else exits nonzero and names the condition that failed. Usage and read
// errors exit 2, so a caller can tell "the repository says no" from "I could not ask".
//
// The numbers are printed, not only the verdict (#815 acceptance 8): `ahead_by` is how far the
// fast-forward would move upstream, and a boolean throws that away.
//
// The ruleset id and both repositories are defaults with an environment override, because the
// runbook has to work from a Bot box where only `api.github.com` answers and nothing is checked in
// about which fork is in use.
//
// Why a 404 from the ruleset endpoint is not "there is no ruleset": GitHub answers 404 for a
// resource the token may not administer, so a token without admin reads the same as a deleted
// ruleset. The message therefore names the id and says which read failed, and the runbook says what
// permission the call needs.

import { fileURLToPath } from 'node:url'

const API = 'https://api.github.com'

export const DEFAULTS = { upstream: 'ThinkFlowLab/FlyBot', fork: 'Birfy/FlyBot', rulesetId: '25173372' }

// `ahead_by` counts commits the fork has that upstream does not: that is the fast-forward distance.
// The comparison is printed with its two endpoints, so a reader never has to guess which way it runs.
export const formatSummary = ({ upstreamSha, forkSha, aheadBy, behindBy, status, ruleset }) => [
  `upstream main : ${upstreamSha}`,
  `fork main     : ${forkSha}`,
  `ahead_by: ${aheadBy}  behind_by: ${behindBy}  status: ${status}`,
  `ruleset ${ruleset.id}: enforcement=${ruleset.enforcement} bypass_actors=${JSON.stringify(ruleset.bypassActors)} current_user_can_bypass=${ruleset.canBypass}`,
]

const short = (s) => String(s ?? '').slice(0, 12)

export async function check({ fetchImpl = globalThis.fetch, env = process.env, log = console.log, argv = [] } = {}) {
  if (!argv.includes('--check')) {
    log('usage: node .github/scripts/upstream-sync.mjs --check')
    return 2
  }
  const upstream = env.UPSTREAM_REPO || DEFAULTS.upstream
  const fork = env.FORK_REPO || DEFAULTS.fork
  const rulesetId = env.RULESET_ID || DEFAULTS.rulesetId
  const token = env.GITHUB_TOKEN || env.GH_TOKEN
  if (!token) {
    log('upstream-sync: no GITHUB_TOKEN or GH_TOKEN — this check only reads, but reads still need a token')
    return 2
  }

  const api = async (path) => {
    const res = await fetchImpl(API + path, {
      method: 'GET',
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'upstream-sync' },
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text }
  }
  const readMain = async (repo) => {
    const r = await api(`/repos/${repo}/git/ref/heads/main`)
    if (r.status !== 200) throw new Error(`cannot read ${repo} main: HTTP ${r.status}`)
    const sha = r.json?.object?.sha
    if (!sha) throw new Error(`cannot read ${repo} main: no sha in the answer`)
    return sha
  }
  const readRuleset = async () => {
    const r = await api(`/repos/${upstream}/rulesets/${rulesetId}`)
    // The id is in the message because the runbook's post-check has to be able to say *what* it could
    // not read; "the ruleset" alone would send the next run looking at the wrong repository.
    if (r.status !== 200) return { error: `ruleset ${rulesetId} cannot be read: HTTP ${r.status}`, id: rulesetId }
    const ruleset = r.json || {}
    return {
      id: rulesetId,
      enforcement: ruleset.enforcement,
      bypassActors: (ruleset.bypass_actors || []).map((a) => a.actor_type + (a.actor_id ? `:${a.actor_id}` : '')),
      canBypass: ruleset.current_user_can_bypass ?? 'unknown',
    }
  }

  let upstreamSha, forkSha
  try {
    upstreamSha = await readMain(upstream)
    forkSha = await readMain(fork)
  } catch (e) {
    log(String(e.message || e))
    return 2
  }

  // A comparison needs both commits to exist; if upstream is far behind, it still does, because the
  // fork is a descendant. A failed compare is reported but does not hide the two SHAs above it.
  let aheadBy = 'unknown', behindBy = 'unknown', status = 'unknown'
  const cmp = await api(`/repos/${upstream}/compare/${upstreamSha}...${forkSha}`)
  if (cmp.status === 200 && cmp.json) {
    aheadBy = cmp.json.ahead_by ?? 'unknown'
    behindBy = cmp.json.behind_by ?? 'unknown'
    status = cmp.json.status ?? 'unknown'
  } else {
    log(`(the comparison ${short(upstreamSha)}...${short(forkSha)} could not be read: HTTP ${cmp.status})`)
  }

  const ruleset = await readRuleset()
  const problems = []
  if (ruleset.error) {
    log(`ruleset ${rulesetId}: ${ruleset.error}`)
    problems.push(ruleset.error)
  } else {
    for (const line of formatSummary({ upstreamSha, forkSha, aheadBy, behindBy, status, ruleset })) log(line)
    if (ruleset.enforcement !== 'active') problems.push(`ruleset ${rulesetId} is ${ruleset.enforcement}, not active — main is unprotected`)
    if (ruleset.bypassActors.length) problems.push(`ruleset ${rulesetId} has bypass actors (${ruleset.bypassActors.join(', ')}), not the empty list the owner decided on`)
  }

  if (upstreamSha !== forkSha) {
    // Both directions are a failure: a fork behind upstream means this check is looking at a tree
    // the next release would not be built on, and a fork ahead is the normal state between a merge
    // and the next window. The numbers say which one it is, so the message carries them.
    problems.push(`fork main ${short(forkSha)} is not upstream main ${short(upstreamSha)} (ahead_by ${aheadBy}, behind_by ${behindBy}) — the fast-forward has not run, or the fork moved again after it`)
  }

  if (!problems.length) {
    log(`CHECK ok — both mains are ${short(upstreamSha)}, ruleset ${rulesetId} is active with no bypass actor`)
    return 0
  }
  for (const p of problems) log(`CHECK FAILED — ${p}`)
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await check({ argv: process.argv.slice(2) }))
}
