#!/usr/bin/env node
// The live E2E preflight (#794). The suite cannot run without DEEPSEEK_API_KEY, and a run that is
// red every night for a reason nobody can act on teaches the team to ignore red. So a missing key
// is a warning, not a failure: this step publishes `key=false`, the workflow skips every step that
// needs the key, and the summary says the run measured nothing. A failure inside the suite still
// fails the run, so the skip is never a pass.
//
// `.github/workflows/live-e2e.yml` runs it as `node .github/scripts/live-e2e-preflight.mjs`, with
// the secret mapped into DEEPSEEK_API_KEY step-scoped and nothing else in the environment.
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const WARNING = '::warning title=Live E2E skipped::DEEPSEEK_API_KEY is not configured as a repository secret; the four real-model checks and the evidence bundle are skipped, so this run measured nothing'

export const SUMMARY = [
  '### Live E2E skipped: no repository secret',
  '',
  '`DEEPSEEK_API_KEY` is not configured, so no step of the suite ran and no evidence bundle was produced.',
  '',
  '**This run is green because there was nothing to run, not because the suite passed.** Add the secret in Settings → Secrets and variables → Actions to measure the suite again (#794).',
]

// A secret that is not configured reaches the step as an empty string, not as a missing variable,
// so both have to mean the same thing here.
export function plan(key) {
  const present = typeof key === 'string' && key.length > 0
  return {
    present,
    output: `key=${present}`,
    warning: present ? null : WARNING,
    summary: present ? null : SUMMARY.join('\n'),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const step = plan(process.env.DEEPSEEK_API_KEY)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${step.output}\n`)
  if (step.warning) console.log(step.warning)
  if (step.summary && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${step.summary}\n`)
}
