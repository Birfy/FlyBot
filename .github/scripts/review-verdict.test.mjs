// The review-body door (#801): a PASS posted as a review body whose `Written-by:` names someone the
// policy does not list used to get nothing at all — no label, no note. It now warns, from a workflow
// with no write scope, and stays green. These cases pin the five kill conditions of the issue, one
// test each, so deleting a check turns exactly one of them red.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WARN_TITLE, annotation, planVerdict, run } from './review-verdict.mjs'
import { planCommentRun } from './pass-label.mjs'

const repo = join(import.meta.dirname, '..', '..')
const workflow = readFileSync(join(repo, '.github/workflows/review-verdict.yml'), 'utf8')
const policy = JSON.parse(readFileSync(join(repo, '.github/agent/review-policy.json'), 'utf8'))
const writers = policy.writers
const head = 'df5d6f7e2b1c4f7a9e0d3c5b8a1f2e4d6c8b0a13'

const report = (writer, { sha = head, verdict = 'PASS' } = {}) => `Verdict: ${verdict} at ${sha}
Written-by: ${writer}

## What I ran
- \`cd core && npm test\` → 1239/1239`

// A writer that is not in the policy, so the case cannot silently become "listed" when the roster grows.
const stranger = 'Nightshift'
const listed = writers.includes('Reviewer') ? 'Reviewer' : writers[0]
assert.ok(!writers.includes(stranger), 'the stranger used by these tests must stay outside the policy')
assert.ok(listed, 'the policy must list at least one writer')

test('#801: a stranger PASS in a review body warns, naming the writer, the tip and the policy file', () => {
  const plan = planVerdict({ body: report(stranger), association: 'MEMBER', writers })
  assert.equal(plan.warn, true)
  assert.equal(plan.writer, stranger)
  assert.equal(plan.tip, head)
  assert.match(plan.message, new RegExp(stranger))
  assert.match(plan.message, new RegExp(head))
  assert.match(plan.message, /\.github\/agent\/review-policy\.json/)
})

test('#801: a listed writer is silence — the kill condition for the writers check', () => {
  const plan = planVerdict({ body: report(listed), association: 'MEMBER', writers })
  assert.equal(plan.warn, false)
})

test('#801: a review by someone GitHub does not tie to this repository is silence — the association kill', () => {
  for (const association of ['CONTRIBUTOR', 'NONE', 'FIRST_TIME_CONTRIBUTOR', '']) {
    assert.equal(planVerdict({ body: report(stranger), association, writers }).warn, false, `association ${association || '(missing)'}`)
  }
  // The same body from a member does warn, so the case above is about the association, not the body.
  assert.equal(planVerdict({ body: report(stranger), association: 'COLLABORATOR', writers }).warn, true)
})

test('#801: a Correction is not a verdict, whatever it quotes', () => {
  const body = `Correction from Reviewer: the PASS at ${head} was withdrawn
Written-by: ${stranger}

Verdict: PASS at ${head}
Written-by: ${stranger}`
  assert.equal(planVerdict({ body, association: 'MEMBER', writers }).warn, false)
})

test('#801: an empty review body (an approve with no text) is silence', () => {
  for (const body of ['', '   ', '\n\n', undefined]) {
    assert.equal(planVerdict({ body, association: 'MEMBER', writers }).warn, false)
  }
})

test('#801: a verdict that is not a PASS is silence', () => {
  for (const verdict of ['INC', 'REQUEST_CHANGES', 'FAIL']) {
    assert.equal(planVerdict({ body: report(stranger, { verdict }), association: 'MEMBER', writers }).warn, false, verdict)
  }
})

test('#801: the job exits 0 on every path — the always-green kill', () => {
  const out = []
  const code = run(
    { REVIEW_BODY: report(stranger), REVIEW_ASSOCIATION: 'MEMBER', PR: '801' },
    { writers, summary: '', log: (line) => out.push(line) },
  )
  assert.equal(code, 0)
  assert.ok(out.some((line) => line.startsWith('::warning')))
  // Silence is green too, and prints no warning at all.
  const quiet = []
  assert.equal(run({ REVIEW_BODY: report(listed), REVIEW_ASSOCIATION: 'MEMBER', PR: '801' }, { writers, summary: '', log: (l) => quiet.push(l) }), 0)
  assert.ok(!quiet.some((line) => line.startsWith('::warning')))
  // The entry point never exits non-zero, not even when the policy or the body is unreadable.
  const source = readFileSync(join(repo, '.github/scripts/review-verdict.mjs'), 'utf8')
  const exits = source
    .split('\n')
    .filter((line) => line.includes('process.exit('))
    .map((line) => line.slice(line.indexOf('process.exit(') + 'process.exit('.length, line.lastIndexOf(')')).trim())
  assert.ok(exits.length > 0, 'the entry point should exit explicitly')
  for (const arg of exits) assert.ok(['0', 'run()'].includes(arg), `review-verdict must never exit non-zero, found process.exit(${arg})`)
})

test('#801: the workflow grants nothing but contents: read — the permissions kill', () => {
  assert.doesNotMatch(workflow, /:\s*write\b/, 'no write scope of any kind')
  const lines = workflow.split('\n')
  const at = lines.findIndex((line) => /^permissions:\s*$/.test(line))
  assert.notEqual(at, -1, 'the workflow must state its permissions explicitly')
  const block = []
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '' || line.startsWith('#')) continue
    if (!line.startsWith('  ')) break
    block.push(line.trim())
  }
  assert.deepEqual(block, ['contents: read'])
  assert.doesNotMatch(workflow, /pull_request_target/, 'never pull_request_target')
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./, 'no secret is read')
})

test('#801: the workflow runs main\'s copy of the script, never the merge ref', () => {
  assert.match(workflow, /ref:\s*main\b/, 'checkout main')
  assert.doesNotMatch(workflow, /refs\/pull\//)
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.(head|merge_commit_sha)/)
  assert.match(workflow, /run:\s*node \.github\/scripts\/review-verdict\.mjs/)
  assert.match(workflow, /pull_request_review/)
})

test('#801: the annotation is one line, and the summary carries the same sentence', () => {
  const plan = planVerdict({ body: report(stranger), association: 'MEMBER', writers })
  const line = annotation(plan)
  assert.ok(line.startsWith(`::warning title=${WARN_TITLE}::`))
  assert.doesNotMatch(line, /\n/)
  const dir = mkdtempSync(join(tmpdir(), 'review-verdict-'))
  const summary = join(dir, 'summary.md')
  writeFileSync(summary, '')
  run({ REVIEW_BODY: report(stranger), REVIEW_ASSOCIATION: 'MEMBER', PR: '801' }, { writers, summary, log: () => {} })
  const written = readFileSync(summary, 'utf8')
  assert.match(written, new RegExp(WARN_TITLE))
  assert.match(written, new RegExp(`${stranger}.*not in the \`writers\` list`, 's'))
})

test('#801: the comment door from #767 is unchanged', () => {
  const plan = planCommentRun({ pr: 801, body: report(stranger), association: 'MEMBER', writers, labels: [], comments: () => [] })
  assert.equal(plan.write, 'comment')
  assert.equal(plan.writer, stranger)
})
