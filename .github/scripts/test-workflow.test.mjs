// test.yml: the shape that a merge queue and the required `tests-ok` check rely on (text checks; no YAML parser needed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const text = readFileSync(new URL('../workflows/test.yml', import.meta.url), 'utf8')
const triggers = text.slice(text.indexOf('\non:\n'), text.indexOf('\nconcurrency:'))
const job = name => {
  const start = text.indexOf(`\n  ${name}:\n`)
  assert.ok(start >= 0, `no job ${name}`)
  const next = text.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/)
  return text.slice(start, next < 0 ? undefined : start + 1 + next)
}

test('triggers: pull_request, merge_group (no filters), push only on main, dispatch', () => {
  assert.match(triggers, /^ {2}pull_request:\s*$/m)
  assert.match(triggers, /^ {2}merge_group:\s*$/m, 'a merge queue needs merge_group or required checks never report on queue entries')
  assert.match(triggers, /^ {2}workflow_dispatch:\s*$/m)
  assert.match(triggers, /^ {2}push:\n {4}branches: \[main\]$/m, 'push stays on main so gh-readonly-queue/* branches do not run twice')
  const mergeGroup = triggers.slice(triggers.search(/^ {2}merge_group:/m)).split('\n').slice(1).filter(l => l.trim() && !l.trim().startsWith('#'))
  assert.ok(!/^ {4}(paths|paths-ignore|branches)/.test(mergeGroup[0] ?? ''), 'merge_group takes no path or branch filters')
  assert.match(triggers, /paths-ignore: \['docs\/\*\*', '\*\*\/\*\.md'\]/, 'paths-ignore is on push only')
  assert.ok(triggers.indexOf('paths-ignore') < triggers.indexOf('pull_request:'), 'paths-ignore must stay under push, not pull_request or merge_group')
})

test('no job is skipped on merge_group: nothing keys on the pull_request event', () => {
  assert.doesNotMatch(text, /github\.event\.pull_request/)
  assert.doesNotMatch(text, /event_name\s*[!=]=\s*'pull_request'/)
  for (const name of ['test', 'plugins', 'package']) assert.doesNotMatch(job(name), /^\s+if:/m, `${name} must run for every event`)
})

test('tests-ok: always runs and is green only when test, plugins and package are', () => {
  const ok = job('tests-ok')
  assert.match(ok, /^ {4}name: tests-ok$/m)
  assert.match(ok, /^ {4}if: always\(\)$/m)
  assert.match(ok, /needs: \[test, plugins, package\]/)
  assert.match(ok, /\[ "\$TEST" = success \] && \[ "\$PLUGINS" = success \] && \[ "\$PACKAGE" = success \]/)
})

test('main keeps its run (no cancel), every other ref, queue branches included, cancels', () => {
  assert.match(text, /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/)
  assert.match(text, /group: test-\$\{\{ github\.ref \}\}/)
})

// live-e2e.yml (#811): the gates that make a keyless run touch nothing. The preflight decides and
// publishes `key=true|false`; the step that reads the secret and the six steps that need it are
// gated on that output. The hole this closes is real: on #30, deleting one `if:` changed what a
// keyless run does and every test still passed, because nothing read this file.
const live = readFileSync(new URL('../workflows/live-e2e.yml', import.meta.url), 'utf8')
const liveSteps = live
  .split(/^ {6}- /m)
  .slice(1)
  .map(block => ({
    block,
    name: (/^name: (.+)$/m.exec(block)?.[1] ?? '(no name)').trim(),
    id: (/^ {8}id: (.+)$/m.exec(block)?.[1] ?? '').trim(),
    gate: (/^ {8}if: (.+)$/m.exec(block)?.[1] ?? '').trim(),
    // The step's own `env:` mapping, not a mention of the secret anywhere in the block.
    mapsSecret: /^ {8}env:\n(?: {10}.*\n)+/m.test(block) && /secrets\./.test(block),
  }))
const KEYED = [
  'npm ci (core)',
  'Install the pinned DSH runtime',
  'Clone DeepSeek Harness at the pinned tag',
  'Start the usage tap',
  'Start the real-model bench',
  'Run the four checks',
]

test('#811: a step that maps a secret is gated on the preflight, and the preflight is gated on nothing', () => {
  const preflight = liveSteps.filter(step => step.id === 'preflight')
  assert.equal(preflight.length, 1, 'exactly one step decides, and it is found by id: preflight')
  assert.equal(preflight[0].gate, '', 'the deciding step cannot be gated on its own output')
  assert.ok(preflight[0].mapsSecret, 'the deciding step has to read the key, or nothing is decided')
  for (const step of liveSteps) {
    if (step.mapsSecret && step.id !== 'preflight') {
      assert.ok(step.gate, `"${step.name}" maps a secret without an if:; a keyless run would execute it`)
      assert.match(step.gate, /steps\.preflight\.outputs\.key/, `"${step.name}" must be gated on steps.preflight.outputs.key`)
    }
  }
})

test('#811: the seven steps that need the key carry the same gate', () => {
  for (const name of [...KEYED, 'Stop the bench and the tap']) {
    const step = liveSteps.find(s => s.name === name)
    assert.ok(step, `no step named "${name}"`)
    assert.match(step.gate, /steps\.preflight\.outputs\.key == 'true'/, `"${name}" lost its gate`)
  }
  const cleanup = liveSteps.find(s => s.name === 'Stop the bench and the tap')
  assert.match(cleanup.gate, /^always\(\) &&/, 'the cleanup runs only after a keyed run started')
  assert.equal(KEYED.length, 6, 'six steps need the key; a seventh would not be covered here')
})
