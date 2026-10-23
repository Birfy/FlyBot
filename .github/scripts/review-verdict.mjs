// The other door on a PASS that does not count (#801): a conclusion posted as a *review body*.
//
//   REVIEW_BODY=... REVIEW_ASSOCIATION=MEMBER node .github/scripts/review-verdict.mjs
//
// `#797` made `pass-label` say — in a comment — that a PASS whose `Written-by:` names someone outside
// the policy's `writers` does not count. That job fires on `issue_comment` only, so the same PASS
// posted as a review body still got silence: no label and no note. This closes that door without
// widening anything. Its workflow is read-only (`permissions: contents: read`, no secrets), it checks
// out `main` so the logic that runs is always main's, and it never writes: a stranger's PASS prints a
// `::warning` and the same sentence in the run summary, then exits 0.
//
// Exit 0 always. This is a report, like `review-gate`; a job that turns red is a job people learn to
// ignore. Nothing here can label, comment, approve or merge — the review-triggered workflow holds no
// write scope at all, so a pull request that edits it can only change what its own review job prints.
//
// Silence is the answer for: an empty review body (an approve with no text), a verdict that is not a
// PASS at some tip, a `Correction from …` (a correction is not a verdict), a review by someone GitHub
// does not tie to this repository, and a writer the policy lists. The rule itself is
// `strangerPassOf` from `pass-label.mjs` — one implementation, so the comment door and the review door
// cannot drift apart.
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { strangerPassOf } from './pass-label.mjs'
import { loadPolicy } from './review-gate.mjs'

export const POLICY = '.github/agent/review-policy.json'
export const WARN_TITLE = 'PASS by a writer the policy does not list'

// The sentence both the annotation and the summary carry: who wrote it, which tip it names, and the
// one edit that makes the next one count. It never claims the pull request is unmergeable.
export function warningText({ writer, tip }) {
  return `A PASS at \`${tip}\` was posted as a review body with \`Written-by: ${writer}\`, and ${writer} is not in the \`writers\` list of \`${POLICY}\`, so this conclusion does not count: \`review-gate\` and \`merge-gate\` both refuse it. What makes the next one count: add the name to \`writers\` in \`${POLICY}\` — that file is T3 — or post the PASS again from a writer the policy lists.`
}

// What one review body means, before any output: a warning, or silence with the reason.
export function planVerdict({ body, association, writers = [] }) {
  const stranger = strangerPassOf(body, { writers, association })
  if (!stranger) return { warn: false, reason: 'not a PASS from a writer the policy does not list' }
  return { warn: true, writer: stranger.writer, tip: stranger.tip, message: warningText(stranger) }
}

// A GitHub annotation is one line, so the message's newlines (it has none today, but the summary and
// the annotation must not disagree) collapse before they reach the `::warning`.
export function annotation({ message }) {
  return `::warning title=${WARN_TITLE}::${String(message).replace(/\r?\n/g, ' ')}`
}

// The workflow's whole job. Returns the process exit code; it is 0 on every path, warning or silence.
export function run(env = process.env, { summary = env.GITHUB_STEP_SUMMARY, writers, log = console.log } = {}) {
  const list = writers ?? loadPolicy(env.POLICY_PATH || POLICY).writers
  const plan = planVerdict({ body: env.REVIEW_BODY ?? '', association: env.REVIEW_ASSOCIATION ?? '', writers: list })
  const where = `#${env.PR || '?'}`
  if (!plan.warn) {
    log(`review-verdict: ${where} — silent (${plan.reason})`)
    return 0
  }
  log(annotation(plan))
  if (summary) appendFileSync(summary, `### ${WARN_TITLE}\n\n${plan.message}\n`)
  else log(plan.message)
  log(`review-verdict: ${where} — warned: ${plan.writer} at ${plan.tip} (report only, no write)`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // No try/catch that exits non-zero: a broken policy file must not take the job red either. Say it,
  // stay green, and let `review-gate` (which gates nothing on its own) be the place that refuses.
  try {
    process.exit(run())
  } catch (error) {
    console.log(`::warning title=review-verdict could not read the review body::${String(error.message).replace(/\r?\n/g, ' ')}`)
    process.exit(0)
  }
}
