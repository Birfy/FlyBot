#!/usr/bin/env node
// FlyBot's core = pristine upstream ds-bot (ds-bot/, pinned in ds-bot.pin.json) + the ordered
// patch series in patches/ds-bot/. This script keeps the three in step (see #34).
//
//   node scripts/ds-bot-patches.mjs apply      rebuild core/ from ds-bot/ + patches (overwrites core/)
//   node scripts/ds-bot-patches.mjs check      CI: ds-bot/ matches the pin, every patch applies cleanly
//                                              in order, and the result equals the committed core/
//   node scripts/ds-bot-patches.mjs generate   rewrite patches/ds-bot/*.patch from core/ vs ds-bot/,
//                                              split by patches/ds-bot/topics.json (after editing core/)
//
// Upgrading the pin: replace ds-bot/ with upstream's ds-bot/ at the new commit, update
// ds-bot.pin.json (commit, tree = `git rev-parse <commit>:ds-bot` upstream, version), run
// `apply`; fix each patch that fails (edit core/ by hand), then `generate`, `check`, test.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PIN = JSON.parse(readFileSync(join(ROOT, 'ds-bot.pin.json'), 'utf8'))
const UPSTREAM = PIN.path ?? 'ds-bot'
const CORE = 'core'
const PATCHES = join(ROOT, 'patches', 'ds-bot')
const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, ...opts })
const tracked = dir => git(['ls-files', '-z', '--', dir]).split('\0').filter(Boolean).map(f => relative(dir, f))
const series = () => readdirSync(PATCHES).filter(f => /^\d{4}-.*\.patch$/.test(f)).sort()
const fail = (message) => { console.error(`ds-bot-patches: ${message}`); process.exit(1) }

// ds-bot/'s tracked files, copied as they are on disk, then each patch applied in order.
function build(out) {
  rmSync(join(ROOT, out), { recursive: true, force: true })
  for (const file of tracked(UPSTREAM)) {
    mkdirSync(dirname(join(ROOT, out, file)), { recursive: true })
    cpSync(join(ROOT, UPSTREAM, file), join(ROOT, out, file))
  }
  for (const patch of series()) {
    try {
      git(['apply', '--whitespace=nowarn', `--directory=${out}`, '-p1', join(PATCHES, patch)], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) { fail(`${patch} does not apply cleanly:\n${error.stderr || error.message}`) }
  }
}

function checkPin() {
  // The tree of ds-bot/ as staged (equals HEAD in CI), so the check also works before a commit.
  const tree = git(['ls-tree', git(['write-tree']).trim(), UPSTREAM]).split(/\s+/)[2]
  if (tree !== PIN.tree) fail(`${UPSTREAM}/ is tree ${tree}, the pin says ${PIN.tree} (${PIN.repo}@${PIN.commit.slice(0, 7)}). Do not edit ${UPSTREAM}/; change patches/ds-bot/.`)
  const dirty = [git(['diff', '--name-only', '--', UPSTREAM]), git(['ls-files', '--others', '--exclude-standard', '--', UPSTREAM])].join('').trim()
  if (dirty) fail(`${UPSTREAM}/ has unstaged or untracked changes:\n${dirty}`)
  console.log(`ok   ${UPSTREAM}/ = ${PIN.repo}@${PIN.commit.slice(0, 7)} (tree ${PIN.tree.slice(0, 7)}, v${PIN.version})`)
}

function check() {
  checkPin()
  const out = '.ds-bot-check'
  try {
    build(out)
    console.log(`ok   ${series().length} patches apply cleanly in order`)
    const want = new Set(tracked(CORE))
    const have = new Set(readdirTree(join(ROOT, out)))
    const problems = []
    for (const f of want) if (!have.has(f)) problems.push(`core/${f}: committed but not produced by the patches`)
    for (const f of have) {
      if (!want.has(f)) problems.push(`core/${f}: produced by the patches but not committed`)
      else if (!readFileSync(join(ROOT, out, f)).equals(readFileSync(join(ROOT, CORE, f)))) problems.push(`core/${f}: differs from ds-bot/ + patches`)
    }
    if (problems.length) fail(`core/ is not ds-bot/ + patches/ds-bot/ (edit core/, then run generate; or run apply):\n  ${problems.join('\n  ')}`)
    console.log('ok   core/ equals ds-bot/ + patches/ds-bot/')
  } finally { rmSync(join(ROOT, out), { recursive: true, force: true }) }
}

function readdirTree(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? readdirTree(join(dir, e.name), base) : [relative(base, join(dir, e.name))]))
}

function generate() {
  const topics = JSON.parse(readFileSync(join(PATCHES, 'topics.json'), 'utf8'))
  const upstream = new Set(tracked(UPSTREAM))
  const core = new Set(tracked(CORE))
  const changed = [...new Set([...upstream, ...core])].sort().filter(f => !upstream.has(f) || !core.has(f) ||
    !readFileSync(join(ROOT, UPSTREAM, f)).equals(readFileSync(join(ROOT, CORE, f))))
  const topicOf = f => Object.keys(topics).find(t => topics[t].some(p => (p.endsWith('/') ? f.startsWith(p) : f === p)))
  const missing = changed.filter(f => !topicOf(f))
  if (missing.length) fail(`changed files with no topic in patches/ds-bot/topics.json:\n  ${missing.join('\n  ')}`)
  for (const old of series()) rmSync(join(PATCHES, old))
  for (const topic of Object.keys(topics)) {
    const files = changed.filter(f => topicOf(f) === topic)
    if (!files.length) continue
    let text = `FlyBot patch ${topic} on ${PIN.repo}@${PIN.commit.slice(0, 7)} (${UPSTREAM}/). Generated by scripts/ds-bot-patches.mjs; ${files.length} file(s).\n\n`
    for (const f of files) {
      const a = upstream.has(f) ? `${UPSTREAM}/${f}` : '/dev/null'
      const b = core.has(f) ? `${CORE}/${f}` : '/dev/null'
      let diff
      try { diff = git(['diff', '--no-index', '--binary', '--full-index', '--no-color', '--', a, b]) } catch (error) { diff = error.stdout }
      text += diff.split(`a/${UPSTREAM}/`).join('a/').split(`b/${CORE}/`).join('b/').split(`a/${CORE}/`).join('a/').split(`b/${UPSTREAM}/`).join('b/')
    }
    writeFileSync(join(PATCHES, `${topic}.patch`), text)
    console.log(`wrote patches/ds-bot/${topic}.patch (${files.length} files)`)
  }
}

const command = process.argv[2]
if (command === 'apply') { build(CORE); console.log(`core/ rebuilt from ${UPSTREAM}/ + ${series().length} patches`) }
else if (command === 'check') check()
else if (command === 'generate') generate()
else if (command === 'pin') checkPin()
else fail('usage: node scripts/ds-bot-patches.mjs apply|check|generate|pin')
if (!existsSync(PATCHES)) fail('patches/ds-bot/ is missing')
