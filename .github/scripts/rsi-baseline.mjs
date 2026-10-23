// The RSI baseline reporter (#791): two metric groups, GitHub as the only source of truth.
//
//   GITHUB_TOKEN=... node .github/scripts/rsi-baseline.mjs \
//     --repo ThinkFlowLab/FlyBot --repo Birfy/FlyBot --day 2026-10-22 [--offset +00:00] [--out FILE]
//
// Group 1 is daily Issue/PR throughput. It counts **entities at their terminal event**: an Issue
// opened or closed, a PR opened, merged, or closed without a merge. A label change, a claim, or an
// issue being turned into a PR is not progress and is not counted. `net open` is
// `created before the end of the day - closed before the end of the day`, which is the only
// historical open count the API can support; it is labelled as such and shown as unknown when a
// count is unavailable.
//
// Group 2 is daily CI outcomes per repository. It counts **runs**, not PRs, so a retried workflow (two
// attempts of the same PR) is two runs and one PR. Runs are bucketed by conclusion — success,
// failure, cancelled, other/unknown — and the success rate is
// `success / (success + failure + cancelled + other)`, printed as numerator/denominator/percent.
// `pull_request` runs and `merge_group` runs are reported separately: a green PR-head run says
// nothing about the merge-queue run, so the two are never summed into one "green" number.
//
// Rules for missing data, from the issue: an unknown value prints as `unknown/not available`, never
// as 0; every report states its window, timezone and repositories; every run and every entity count
// links to its source. This is a baseline: the report claims no improvement, and comparing two days
// is an opinion until an experiment says what "better" means.
//
// Read-only: it reads counts, timestamps and run conclusions, and writes nothing to GitHub.
import { writeFileSync } from 'node:fs'

export const API = 'https://api.github.com'
export const TIMEZONE = 'UTC'
export const UNKNOWN = 'unknown/not available'
export const GROUPS = ['issuesOpened', 'issuesClosed', 'prsOpened', 'prsMerged', 'prsClosedUnmerged', 'netOpenIssues', 'netOpenPulls']
export const CONCLUSION_BUCKETS = ['success', 'failure', 'cancelled', 'other', 'unknown']
// Events worth separating: a queue run and a PR-head run answer different questions.
export const EVENT_GROUPS = ['pull_request', 'merge_group', 'push', 'other']

const DAY_MS = 24 * 60 * 60 * 1000
// A day with 800 runs must not turn the report into a wall of links; past this the API query is the source.
const MAX_LINKS = 120

// A calendar day as a half-open window [00:00, 24:00) in the given fixed offset (minutes east of UTC).
// GitHub timestamps are UTC, so the offset only moves the boundaries; the day itself is what a human
// reading the report means by "yesterday".
export function dayWindow(day, offsetMinutes = 0) {
  const start = Date.parse(`${day}T00:00:00.000Z`) - offsetMinutes * 60_000
  if (!Number.isFinite(start)) throw new Error(`rsi-baseline: "${day}" is not a YYYY-MM-DD date`)
  return { day, offsetMinutes, start, end: start + DAY_MS }
}

export const withinWindow = (iso, win) => {
  const at = Date.parse(iso)
  return Number.isFinite(at) && at >= win.start && at < win.end
}

// "+08:00" / "-0230" / "0" → minutes east of UTC. A named zone is refused on purpose: DST makes a
// local day 23 or 25 hours long, and a report whose day length is implicit is not auditable.
export function parseOffset(text) {
  const value = String(text ?? '').trim()
  if (!value || value === 'Z' || value === 'UTC' || value === '+00:00') return 0
  const match = value.match(/^([+-])(\d{1,2}):?(\d{2})?$/)
  if (!match) throw new Error(`rsi-baseline: unsupported timezone "${value}"; use a fixed offset such as +08:00 or UTC`)
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0)
  if (minutes > 14 * 60) throw new Error(`rsi-baseline: offset "${value}" is out of range`)
  return match[1] === '-' ? -minutes : minutes
}

export const formatOffset = (minutes) => {
  if (!minutes) return 'UTC'
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

// A PR is "closed without merge" only when it has a close time and never merged; a merged PR also has
// a `closed_at`, so the merged branch has to come first.
export const closedUnmergedAt = (pull) => (pull?.merged_at ? null : (pull?.closed_at ?? null))

export function throughput({ win, issues = [], pulls = [], netOpen = {} }) {
  const count = (items, pick) => items.filter((item) => pick(item) && withinWindow(pick(item), win)).length
  return {
    issuesOpened: count(issues, (issue) => issue?.created_at),
    issuesClosed: count(issues, (issue) => issue?.closed_at),
    prsOpened: count(pulls, (pull) => pull?.created_at),
    prsMerged: count(pulls, (pull) => pull?.merged_at),
    prsClosedUnmerged: count(pulls, closedUnmergedAt),
    netOpenIssues: netOpen.issues ?? null,
    netOpenPulls: netOpen.pulls ?? null,
  }
}

const emptyBuckets = () => Object.fromEntries(CONCLUSION_BUCKETS.map((name) => [name, 0]))

// Completed runs only: an in-progress run has no conclusion yet, so counting it as a failure (or as a
// success) would make the rate depend on when the report happens to run.
export function summarizeRuns({ runs = [] } = {}) {
  const all = emptyBuckets()
  const byEvent = Object.fromEntries(EVENT_GROUPS.map((name) => [name, emptyBuckets()]))
  let running = 0
  for (const run of runs) {
    if (run?.status !== 'completed') {
      running += 1
      continue
    }
    const conclusion = run.conclusion
    const bucket = !conclusion ? 'unknown'
      : conclusion === 'success' || conclusion === 'failure' || conclusion === 'cancelled' ? conclusion
        : 'other'
    all[bucket] += 1
    const event = EVENT_GROUPS.includes(run.event) ? run.event : 'other'
    byEvent[event][bucket] += 1
  }
  return { all, byEvent, running, ...rates(all) }
}

// The denominator is every completed run with a known conclusion. Cancelled runs are known — a
// concurrency cancellation is a real outcome — so they stay in the denominator; folding them out
// would let a day of cancelled runs look perfect.
export function rates(buckets) {
  const denominator = buckets.success + buckets.failure + buckets.cancelled + buckets.other
  return {
    denominator,
    successRate: denominator === 0 ? null : buckets.success / denominator,
  }
}

// "42/57 = 73.7%", or the honest string when there is nothing to divide.
export function formatRate(success, denominator) {
  if (!denominator) return UNKNOWN
  return `${success}/${denominator} = ${((100 * success) / denominator).toFixed(1)}%`
}

export const formatCount = (value) => (value === null || value === undefined ? UNKNOWN : String(value))

// The 7-day rolling average is context only; it is computed from the same raw counts and never
// replaces them, so a flat week cannot hide a spike.
export function rollingAverage(values) {
  const clean = values.filter((value) => Number.isFinite(value))
  if (clean.length === 0) return null
  return clean.reduce((sum, value) => sum + value, 0) / clean.length
}

export function renderReport(model) {
  const { win, repos, generatedAt, throughputByRepo, runsByRepo, notes = [] } = model
  const zone = formatOffset(win.offsetMinutes)
  const lines = []
  lines.push(`# RSI baseline — ${win.day}`)
  lines.push('')
  lines.push(`Window: \`${new Date(win.start).toISOString()}\` to \`${new Date(win.end).toISOString()}\` (half-open, ${zone}; default ${TIMEZONE}).`)
  lines.push(`Repositories: ${repos.map((repo) => `\`${repo}\``).join(', ')}. Generated ${generatedAt} from the GitHub REST API.`)
  lines.push('')
  lines.push('This is a baseline record. It claims no improvement: it has no experiment, no comparison and no pass/fail threshold.')
  lines.push('')

  lines.push('## 1. Daily Issue/PR throughput')
  lines.push('')
  lines.push('| Repository | Issues opened | Issues closed | PRs opened | PRs merged | PRs closed unmerged | Net open issues | Net open PRs |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const repo of repos) {
    const row = throughputByRepo[repo] ?? {}
    lines.push(`| \`${repo}\` | ${GROUPS.slice(0, 5).map((key) => formatCount(row[key])).join(' | ')} | ${formatCount(row.netOpenIssues)} | ${formatCount(row.netOpenPulls)} |`)
  }
  lines.push('')
  lines.push('Formulas: a count is the number of those entities whose terminal timestamp falls inside the window; `closed unmerged` requires `closed_at` inside the window and `merged_at` empty; `net open` is `created before the end of the window - closed before the end of the window`, computed from search counts and shown as unknown when a count is unavailable. A labelled, claimed or converted Issue is not counted as processed.')
  lines.push('')

  lines.push('## 2. Daily CI outcomes')
  lines.push('')
  lines.push('| Repository | Event | Runs | Success | Failure | Cancelled | Other | Unknown | Success rate |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const repo of repos) {
    const summary = runsByRepo[repo]
    if (!summary) {
      lines.push(`| \`${repo}\` | all | ${UNKNOWN} | ${UNKNOWN} | ${UNKNOWN} | ${UNKNOWN} | ${UNKNOWN} | ${UNKNOWN} | ${UNKNOWN} |`)
      continue
    }
    for (const event of EVENT_GROUPS) {
      const buckets = summary.byEvent[event]
      const total = CONCLUSION_BUCKETS.reduce((sum, key) => sum + buckets[key], 0)
      if (total === 0) continue
      const { denominator, successRate } = rates(buckets)
      lines.push(`| \`${repo}\` | ${event} | ${total} | ${buckets.success} | ${buckets.failure} | ${buckets.cancelled} | ${buckets.other} | ${buckets.unknown} | ${successRate === null ? UNKNOWN : formatRate(buckets.success, denominator)} |`)
    }
    const { all, ...rest } = summary
    const total = CONCLUSION_BUCKETS.reduce((sum, key) => sum + all[key], 0)
    lines.push(`| \`${repo}\` | **all** | ${total} | ${all.success} | ${all.failure} | ${all.cancelled} | ${all.other} | ${all.unknown} | ${rest.successRate === null ? UNKNOWN : formatRate(all.success, rest.denominator)} |`)
  }
  lines.push('')
  lines.push('Formulas: `runs` counts runs whose `created_at` is inside the window, not unique PRs, so a retried workflow is two runs; `unknown` is a completed run with no conclusion and `other` is any conclusion outside success/failure/cancelled; the denominator is `success + failure + cancelled + other` (cancelled runs stay in it); an empty denominator prints as unknown rather than 0%. `merge_group` runs are the queue, `pull_request` runs are the head; a green head run is not evidence about the queue.')
  lines.push('')

  const linked = repos.flatMap((repo) => (runsByRepo[repo]?.urls ?? []).map((run) => `- \`${repo}\` [${run.name ?? 'run'} ${run.id}](${run.html_url}) — ${run.event}, ${run.conclusion ?? run.status}`))
  if (linked.length) {
    lines.push('### Source runs')
    lines.push('')
    lines.push(...linked.slice(0, MAX_LINKS))
    if (linked.length > MAX_LINKS) {
      lines.push(`- ${linked.length - MAX_LINKS} more runs of this day are not listed; the full list per repository is \`GET https://api.github.com/repos/<owner>/<name>/actions/runs?created=${win.day}\`.`)
    }
    lines.push('')
  }

  if (notes.length) {
    lines.push('### Notes')
    lines.push('')
    lines.push(...notes.map((note) => `- ${note}`))
    lines.push('')
  }
  return lines.join('\n')
}

// --- GitHub queries -------------------------------------------------------------------------

async function gh(path, token) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'flybot-rsi-baseline' },
  })
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${(await response.text()).slice(0, 200)}`)
  return response.json()
}

async function allPages(path, token, pick = (page) => page) {
  const out = []
  for (let page = 1; page <= 20; page += 1) {
    const body = await gh(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token)
    const items = pick(body)
    out.push(...items)
    if (items.length < 100) break
  }
  return out
}

// Search counts power the historical open count. `incomplete_results` means the number is not the
// whole truth, so it becomes null (unknown) instead of a smaller number.
async function searchCount(query, token) {
  const body = await gh(`/search/issues?q=${encodeURIComponent(query)}&per_page=1`, token)
  return body.incomplete_results ? null : body.total_count
}

export async function collectRepo(repo, token, win) {
  const sinceIso = new Date(win.start).toISOString()
  const items = await allPages(`/repos/${repo}/issues?state=all&since=${encodeURIComponent(sinceIso)}`, token)
  const issues = items.filter((item) => !item.pull_request)
  const pulls = items.filter((item) => item.pull_request)
  // `merged_at` is not on the issues payload; fetch the few PRs that closed inside the window.
  const closedInside = pulls.filter((pull) => pull.state === 'closed' && withinWindow(pull.closed_at, win) && pull.id)
  for (const pull of closedInside) {
    const full = await gh(`/repos/${repo}/pulls/${pull.number}`, token)
    pull.merged_at = full.merged_at
  }
  const endIso = new Date(win.end).toISOString()
  const netOpen = {
    issues: await openAtEnd(repo, 'issue', endIso, token),
    pulls: await openAtEnd(repo, 'pr', endIso, token),
  }
  return { issues, pulls, netOpen }
}

async function openAtEnd(repo, kind, endIso, token) {
  try {
    const created = await searchCount(`repo:${repo} is:${kind} created:<${endIso}`, token)
    const closed = await searchCount(`repo:${repo} is:${kind} closed:<${endIso}`, token)
    if (created === null || closed === null) return null
    return created - closed
  } catch {
    return null
  }
}

export async function collectRuns(repo, token, win) {
  const day = win.day
  const runs = await allPages(`/repos/${repo}/actions/runs?created=${day}`, token, (page) => page.workflow_runs ?? [])
  const inside = runs.filter((run) => withinWindow(run.created_at, win))
  return { runs: inside.map((run) => ({ ...run, urls: { html_url: run.html_url } })) }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = { repos: [], day: previousDayUtc(), offset: 0, out: null }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--repo') args.repos.push(argv[++i])
    else if (flag === '--day') args.day = argv[++i]
    else if (flag === '--offset') args.offset = parseOffset(argv[++i])
    else if (flag === '--out') args.out = argv[++i]
    else if (flag === '--help' || flag === '-h') {
      console.log('usage: rsi-baseline.mjs --repo owner/name [--repo ...] [--day YYYY-MM-DD] [--offset +00:00] [--out FILE]')
      return 0
    } else throw new Error(`rsi-baseline: unknown argument "${flag}"`)
  }
  if (args.repos.length === 0) throw new Error('rsi-baseline: at least one --repo owner/name is required')
  const token = env.GITHUB_TOKEN ?? env.GH_TOKEN ?? env.DSH_SECRET_GITHUB_TOKEN
  if (!token) throw new Error('rsi-baseline: set GITHUB_TOKEN (read-only scope: issues, pulls, actions)')

  const win = dayWindow(args.day, args.offset)
  const throughputByRepo = {}
  const runsByRepo = {}
  for (const repo of args.repos) {
    const { issues, pulls, netOpen } = await collectRepo(repo, token, win)
    throughputByRepo[repo] = throughput({ win, issues, pulls, netOpen })
    const { runs } = await collectRuns(repo, token, win)
    runsByRepo[repo] = summarizeRuns({ runs })
    runsByRepo[repo].urls = runs.map((run) => ({ id: run.id, name: run.name, html_url: run.html_url, event: run.event, conclusion: run.conclusion, status: run.status }))
  }
  const report = renderReport({ win, repos: args.repos, generatedAt: new Date().toISOString(), throughputByRepo, runsByRepo, notes: env.RSI_BASELINE_NOTES ? env.RSI_BASELINE_NOTES.split('|') : [] })
  if (args.out) writeFileSync(args.out, `${report}\n`)
  else console.log(report)
  return 0
}

export function previousDayUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS).toISOString().slice(0, 10)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
