// The `Fetch origin/main for arch-docs check` step of the tests action must never abort a job that
// would otherwise run (#807). actions/checkout can leave `refs/remotes/origin/main` ahead of the base
// the step fetches (two pushes to main seconds apart), and an unforced refspec then dies with
// `! [rejected] … (non-fast-forward)` before lint and the suite run. These tests read the real step
// out of the action and run it against a scratch repository instead of trusting the text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STEP = 'Fetch origin/main for arch-docs check'
const action = readFileSync(new URL('../actions/flybot-tests/action.yml', import.meta.url), 'utf8')

// The step's `run:` block with its YAML indentation removed, so it can be executed as bash.
export function stepScript(name) {
  const start = action.indexOf(`    - name: ${name}\n`)
  assert.ok(start >= 0, `no step named "${name}" in flybot-tests/action.yml`)
  const body = action.slice(start)
  const runAt = body.indexOf('\n      run: |\n')
  assert.ok(runAt >= 0, `step "${name}" has no run block`)
  const out = []
  for (const line of body.slice(runAt + '\n      run: |\n'.length).split('\n')) {
    if (line.trim() === '') out.push('')
    else if (line.startsWith('        ')) out.push(line.slice(8))
    else break
  }
  return out.join('\n').trimEnd() + '\n'
}

const script = stepScript(STEP)
const has = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0
const skip = has('git', ['--version']) && has('bash', ['-c', 'exit 0']) ? false : 'git and bash are needed to run the fetch step'

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' }
const git = (cwd, args, { allowFailure = false } = {}) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV })
  if (!allowFailure) assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`)
  return r
}
const ident = ['-c', 'user.name=test', '-c', 'user.email=test@example.com']

// A repository shaped like a runner: `origin` is a bare repo, `work` is a depth-1 clone whose
// refs/remotes/origin/main is the tip checkout saw, and main then moves back to an older commit.
function scratch(root) {
  const origin = join(root, 'origin.git')
  const src = join(root, 'src')
  const work = join(root, 'work')
  git(root, ['init', '-q', '--bare', origin])
  git(root, ['clone', '-q', `file://${origin}`, src])
  writeFileSync(join(src, 'f'), 'a\n')
  git(src, ['add', 'f'])
  git(src, [...ident, 'commit', '-q', '-m', 'A'])
  const older = git(src, ['rev-parse', 'HEAD']).stdout.trim()
  git(src, ['push', '-q', 'origin', 'HEAD:refs/heads/main'])
  writeFileSync(join(src, 'f'), 'a\nb\n')
  git(src, [...ident, 'commit', '-q', '-am', 'B'])
  git(src, ['push', '-q', 'origin', 'HEAD:refs/heads/main'])
  git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  git(root, ['clone', '-q', '--depth=1', `file://${origin}`, work])
  return { origin, src, work, older }
}

test('the step fetches the base with an explicit force and still verifies it', () => {
  const line = script.split('\n').find(l => l.trim().startsWith('git fetch') && l.includes('refs/remotes/origin/main'))
  assert.ok(line, 'the step still fetches main into refs/remotes/origin/main')
  assert.doesNotMatch(line, /\|\| true/, 'a failed base fetch must fail the job, not be swallowed')
  assert.match(line, / \+main:refs\/remotes\/origin\/main\b/, 'the refspec needs `+`: checkout leaves the ref at the tip, so an older base is a non-fast-forward')
  assert.match(script, /^git merge-base origin\/main HEAD >\/dev\/null$/m, 'the base must stay verified')
  assert.match(script, /^git rev-parse --verify origin\/main\^\{commit\}$/m, 'the base must resolve to a commit')
})

test('a base older than the checkout ref does not abort the step', { skip }, () => {
  const root = mkdtempSync(join(tmpdir(), 'flybot-fetch-base-'))
  try {
    const { src, work, older } = scratch(root)
    const tip = git(work, ['rev-parse', 'refs/remotes/origin/main']).stdout.trim()
    // main moves back after checkout: the ref checkout left behind is now ahead of the base.
    git(src, ['push', '-q', '-f', 'origin', `${older}:refs/heads/main`])
    assert.equal(git(work, ['rev-parse', 'refs/remotes/origin/main']).stdout.trim(), tip, 'the ref stays at the tip checkout saw')

    const stepFile = join(root, 'step.sh')
    writeFileSync(stepFile, script)
    const r = spawnSync('bash', [stepFile], { cwd: work, encoding: 'utf8', env: ENV })
    assert.equal(r.status, 0, `the step aborted: ${r.stderr}`)
    assert.equal(git(work, ['rev-parse', 'refs/remotes/origin/main']).stdout.trim(), older, 'the base the check resolves must be the fetched commit')
    assert.equal(git(work, ['rev-parse', '--verify', 'origin/main^{commit}']).stdout.trim(), older)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a base that cannot be fetched fails instead of passing on the stale ref', { skip }, () => {
  const root = mkdtempSync(join(tmpdir(), 'flybot-fetch-base-'))
  try {
    const { origin, work } = scratch(root)
    // main disappears from origin (renamed): the step must fail rather than verify the ref that
    // checkout left behind, which is what `|| true` on the fetch would do.
    git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/parked'])
    git(origin, ['update-ref', '-d', 'refs/heads/main'])

    const stepFile = join(root, 'step.sh')
    writeFileSync(stepFile, script)
    const r = spawnSync('bash', [stepFile], { cwd: work, encoding: 'utf8', env: ENV })
    assert.notEqual(r.status, 0, 'the step must fail when the base cannot be fetched')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
