// Deterministic tests for the RSI baseline reporter (#791). No network: the counting is pure, the
// fixtures are hand-written, and every case is one the issue names — cancelled runs, retries and
// missing data above all.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  UNKNOWN, MAX_PAGES, dayWindow, withinWindow, parseOffset, formatOffset, throughput, summarizeRuns, rates,
  formatRate, formatCount, rollingAverage, renderReport, closedUnmergedAt, allPages,
} from './rsi-baseline.mjs'

const DAY = '2026-10-22'
const WIN = dayWindow(DAY)

test('a day is a half-open UTC window unless an offset is given', () => {
  assert.equal(new Date(WIN.start).toISOString(), '2026-10-22T00:00:00.000Z')
  assert.equal(new Date(WIN.end).toISOString(), '2026-10-23T00:00:00.000Z')
  assert.equal(withinWindow('2026-10-22T00:00:00Z', WIN), true, 'the first instant belongs to the day')
  assert.equal(withinWindow('2026-10-23T00:00:00Z', WIN), false, 'the next midnight does not')
  assert.equal(withinWindow('2026-10-21T23:59:59Z', WIN), false)

  const east = dayWindow(DAY, parseOffset('+08:00'))
  assert.equal(new Date(east.start).toISOString(), '2026-10-21T16:00:00.000Z')
  assert.equal(new Date(east.end).toISOString(), '2026-10-22T16:00:00.000Z')
  assert.equal(formatOffset(east.offsetMinutes), 'UTC+08:00')
  assert.equal(formatOffset(0), 'UTC')
  assert.equal(parseOffset('UTC'), 0)
  assert.throws(() => parseOffset('Asia/Shanghai'), /fixed offset/)
  assert.throws(() => dayWindow('22-10-2026'), /YYYY-MM-DD/)
})

test('throughput counts entities at their terminal event, not labels or claims', () => {
  const issues = [
    { created_at: '2026-10-22T01:00:00Z', closed_at: '2026-10-22T05:00:00Z' }, // opened + closed
    { created_at: '2026-10-22T02:00:00Z', closed_at: null }, // opened only
    { created_at: '2026-10-20T02:00:00Z', closed_at: '2026-10-22T06:00:00Z' }, // closed only
    { created_at: '2026-10-21T02:00:00Z', closed_at: null, labels: ['agent-ready', 'agent-working'] }, // a claim is not progress
  ]
  const pulls = [
    { created_at: '2026-10-22T03:00:00Z', closed_at: '2026-10-22T04:00:00Z', merged_at: '2026-10-22T04:00:00Z' }, // opened + merged
    { created_at: '2026-10-22T03:30:00Z', closed_at: '2026-10-22T07:00:00Z', merged_at: null }, // opened + closed unmerged
    { created_at: '2026-10-21T03:00:00Z', closed_at: '2026-10-22T09:00:00Z', merged_at: '2026-10-22T09:00:00Z' }, // merged only
  ]
  const counts = throughput({ win: WIN, issues, pulls, netOpen: { issues: 41, pulls: 3 } })
  assert.deepEqual(counts, {
    issuesOpened: 2, issuesClosed: 2, prsOpened: 2, prsMerged: 2, prsClosedUnmerged: 1, netOpenIssues: 41, netOpenPulls: 3,
  })
  // A merged pull request also carries closed_at; it must not be counted twice.
  assert.equal(closedUnmergedAt({ closed_at: '2026-10-22T04:00:00Z', merged_at: '2026-10-22T04:00:00Z' }), null)
  // An unavailable search count is unknown, never zero.
  assert.equal(formatCount(throughput({ win: WIN, netOpen: {} }).netOpenIssues), UNKNOWN)
})

test('cancelled runs stay in the denominator, missing conclusions do not', () => {
  const summary = summarizeRuns({
    runs: [
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
      { status: 'completed', conclusion: 'cancelled' }, // concurrency cancellation is a real outcome
      { status: 'completed', conclusion: 'timed_out' }, // known, but not one of the three
      { status: 'completed', conclusion: null }, // the API has not said yet
      { status: 'in_progress', conclusion: null }, // not completed: not counted at all
    ],
  })
  // A skipped run is not an outcome: it has its own bucket and stays out of the denominator (#814).
  assert.deepEqual(summary.all, { success: 1, failure: 1, cancelled: 1, skipped: 0, other: 1, unknown: 1 })
  assert.equal(summary.running, 1)
  assert.equal(summary.denominator, 4, 'success + failure + cancelled + other; unknown and running are out')
  assert.equal(summary.successRate, 0.25)
  assert.equal(formatRate(summary.all.success, summary.denominator), '1/4 = 25.0%')
  // An empty denominator is "no data", not 0%: a day with nothing completed must not read as a bad day.
  assert.deepEqual(rates({ success: 0, failure: 0, cancelled: 0, other: 0 }), { denominator: 0, successRate: null })
  assert.equal(formatRate(0, 0), UNKNOWN)
})

test('a retried workflow is two runs and one pull request', () => {
  const runs = [
    { status: 'completed', conclusion: 'cancelled', event: 'pull_request', head_sha: 'a'.repeat(40), pull_requests: [{ number: 7 }] },
    { status: 'completed', conclusion: 'success', event: 'pull_request', head_sha: 'a'.repeat(40), pull_requests: [{ number: 7 }] },
  ]
  const summary = summarizeRuns({ runs })
  assert.equal(summary.byEvent.pull_request.success + summary.byEvent.pull_request.cancelled, 2, 'runs, not entities')
  const counts = throughput({ win: WIN, pulls: [{ created_at: '2026-10-22T03:00:00Z', merged_at: '2026-10-22T04:00:00Z', closed_at: '2026-10-22T04:00:00Z' }] })
  assert.equal(counts.prsMerged, 1, 'the pull request is one entity however often it was rerun')
})

test('a green head run is not evidence about the queue', () => {
  const summary = summarizeRuns({
    runs: [
      { status: 'completed', conclusion: 'success', event: 'pull_request' },
      { status: 'completed', conclusion: 'failure', event: 'merge_group' },
      { status: 'completed', conclusion: 'success', event: 'push' },
    ],
  })
  assert.equal(formatRate(summary.byEvent.pull_request.success, summary.byEvent.pull_request.success + summary.byEvent.pull_request.failure), '1/1 = 100.0%')
  assert.equal(formatRate(summary.byEvent.merge_group.success, summary.byEvent.merge_group.success + summary.byEvent.merge_group.failure), '0/1 = 0.0%')
  assert.equal(summary.all.success, 2, 'the totals may be summed, but per event they are reported apart')
  const report = renderReport({
    win: WIN, repos: ['o/r'], generatedAt: '2026-10-22T12:00:00.000Z',
    throughputByRepo: { 'o/r': { issuesOpened: 1, issuesClosed: 0, prsOpened: 1, prsMerged: 1, prsClosedUnmerged: 0, netOpenIssues: null, netOpenPulls: 0 } },
    runsByRepo: { 'o/r': { ...summary, urls: [] } },
  })
  assert.match(report, /\| `o\/r` \| pull_request \| 1 \|/)
  assert.match(report, /\| `o\/r` \| merge_group \| 1 \| 0 \| 1 \|/)
})

test('the report states its window, timezone, repositories and unknowns', () => {
  const report = renderReport({
    win: dayWindow(DAY, 480), repos: ['ThinkFlowLab/FlyBot', 'Birfy/FlyBot'], generatedAt: '2026-10-22T12:00:00.000Z',
    throughputByRepo: { 'ThinkFlowLab/FlyBot': { issuesOpened: 3, issuesClosed: 2, prsOpened: 0, prsMerged: 0, prsClosedUnmerged: 0, netOpenIssues: null, netOpenPulls: null } },
    runsByRepo: { 'ThinkFlowLab/FlyBot': { ...summarizeRuns({ runs: [] }), urls: [] } },
  })
  assert.match(report, /Window: `2026-10-21T16:00:00\.000Z` to `2026-10-22T16:00:00\.000Z`/)
  assert.match(report, /UTC\+08:00/)
  assert.match(report, /Repositories: `ThinkFlowLab\/FlyBot`, `Birfy\/FlyBot`/)
  assert.match(report, /unknown\/not available/)
  assert.match(report, /claims no improvement/)
  assert.match(report, /Formulas:/)
  // A repository with no CI data still gets a row of unknowns instead of a silent zero.
  assert.match(report, /\| `Birfy\/FlyBot` \| all \| unknown\/not available \|/)
})

test('the seven-day average is context and never replaces the raw counts', () => {
  assert.equal(rollingAverage([2, 4, null, 6]), 4)
  assert.equal(rollingAverage([]), null)
  assert.equal(rollingAverage([null, undefined]), null)
})

test('a skipped run is its own bucket and never moves the rate', () => {
  const run = (conclusion, event = 'pull_request') => ({ status: 'completed', conclusion, event })
  const summary = summarizeRuns({ runs: [run('success'), run('success'), run('success'), run('skipped'), run('skipped')] })
  assert.equal(summary.all.skipped, 2, 'skipped has its own bucket, not other')
  assert.equal(summary.all.other, 0, 'nothing was filed as other')
  assert.equal(summary.denominator, 3, 'only the runs that produced an outcome divide the rate')
  assert.equal(summary.successRate, 1)
  assert.equal(formatRate(summary.all.success, summary.denominator), '3/3 = 100.0%')
  // The same rule per event: a queue entry that measured nothing must not read as a queue failure.
  assert.equal(summary.byEvent.pull_request.skipped, 2)
  assert.equal(rates(summary.byEvent.pull_request).denominator, 3)
  // unknown stays out too, and both can arrive on the same day.
  assert.equal(rates({ success: 1, failure: 0, cancelled: 0, skipped: 4, other: 0, unknown: 9 }).denominator, 1)
})

test('a capped listing says it was capped, a short page does not', async () => {
  // The cap is the only thing that can make a fetch wrong, and it is the one thing the API cannot say:
  // a full page 20 means either "there is a page 21" or "exactly 2000", so both have to be marked.
  const request = (sizes) => {
    const calls = []
    const fetchPage = async (url) => {
      const page = Number(new URL(url, 'https://api.github.com').searchParams.get('page'))
      calls.push(page)
      return Array.from({ length: sizes[page - 1] ?? 0 }, (_, index) => ({ n: (page - 1) * 100 + index }))
    }
    return { fetchPage, calls }
  }

  const full = request(Array(MAX_PAGES).fill(100))
  const capped = await allPages('/x', 't', (page) => page, full.fetchPage)
  assert.equal(capped.items.length, 2000)
  assert.equal(capped.truncated, true, 'a full last page means 2000 or more')
  assert.equal(full.calls.length, MAX_PAGES, 'the cap is the request budget')

  const short = request([...Array(MAX_PAGES - 1).fill(100), 99])
  const nearly = await allPages('/x', 't', (page) => page, short.fetchPage)
  assert.equal(nearly.items.length, 1999)
  assert.equal(nearly.truncated, false, 'a short last page ends the listing, nothing was cut')

  const early = request([100, 100, 12])
  const done = await allPages('/x', 't', (page) => page, early.fetchPage)
  assert.equal(done.truncated, false)
  assert.equal(done.items.length, 212)
  assert.equal(early.calls.length, 3, 'a short page stops the walk, it does not read on')
  assert.equal(early.calls.includes(4), false)
})

test('the report carries the skipped column and marks a truncated repository', () => {
  const summary = summarizeRuns({
    runs: [
      { status: 'completed', conclusion: 'success', event: 'pull_request' },
      { status: 'completed', conclusion: 'skipped', event: 'pull_request' },
    ],
  })
  const report = renderReport({
    win: WIN, repos: ['o/r', 'o/quiet'], generatedAt: '2026-10-22T12:00:00.000Z',
    throughputByRepo: {
      'o/r': { issuesOpened: 2, issuesClosed: 0, prsOpened: 1, prsMerged: 0, prsClosedUnmerged: 0, netOpenIssues: 1, netOpenPulls: 0 },
      'o/quiet': { issuesOpened: 0, issuesClosed: 0, prsOpened: 0, prsMerged: 0, prsClosedUnmerged: 0, netOpenIssues: 0, netOpenPulls: 0 },
    },
    runsByRepo: { 'o/r': { ...summary, urls: [] }, 'o/quiet': { ...summarizeRuns({ runs: [] }), urls: [] } },
    truncatedByRepo: { 'o/r': { listing: true, runs: true }, 'o/quiet': { listing: false, runs: false } },
  })
  assert.match(report, /\| Repository \| Event \| Runs \| Success \| Failure \| Cancelled \| Skipped \| Other \| Unknown \| Success rate \|/)
  assert.match(report, /\| `o\/r` \| pull_request \| 2 \| 1 \| 0 \| 0 \| 1 \|/, 'the skipped run has its own cell')
  assert.match(report, /\| `o\/r` \| \*\*all\*\* \| 2 \| 1 \| 0 \| 0 \| 1 \| 0 \| 0 \| 1\/1 = 100\.0% \|/, 'skipped is out of the rate')
  assert.match(report, /`skipped` and `unknown` do not/, 'the formula names the exclusion')
  const markers = report.match(/at least 2000 (items|runs), possibly truncated/g) ?? []
  assert.equal(markers.length, 2, 'one marker for the issue listing, one for the run listing')
  assert.match(report, /`o\/r`: the issue\/PR listing stopped at the page cap/)
  assert.match(report, /`o\/r`: the run listing stopped at the page cap/)
  assert.doesNotMatch(report, /`o\/quiet`[^\n]*possibly truncated/, 'a short listing is a total, so no marker')
})
