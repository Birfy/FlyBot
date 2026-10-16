// Lint the peer plugins under plugins/ with the oxlint that core's `npm run harness` installs
// (core/dev/harness, or DSH_HARNESS), using core's .oxlintrc.json, so plugins need no copy of
// their own. Usage: node scripts/lint-plugins.mjs [name ...]   (default: every plugins/* dir)
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const harness = [process.env.DSH_HARNESS, join(root, 'core', 'dev', 'harness')].filter(Boolean)
const bin = harness.map(dir => join(dir, 'node_modules', 'oxlint', 'bin', 'oxlint')).find(existsSync)
if (!bin) {
  console.error('lint-plugins: no oxlint found; run `npm run harness` in core/, or set DSH_HARNESS')
  process.exit(2)
}
const names = process.argv.slice(2)
const plugins = names.length ? names : readdirSync(join(root, 'plugins'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
let status = 0
for (const name of plugins) {
  const dir = join('plugins', name)
  if (!existsSync(join(root, dir, 'package.json'))) { console.error(`lint-plugins: ${dir} is not a plugin`); status = 2; continue }
  console.log(`=== lint ${dir} ===`)
  const result = spawnSync(process.execPath, [bin, '-c', join('core', '.oxlintrc.json'), '--ignore-pattern', '**/dist/**', dir], { cwd: root, stdio: 'inherit' })
  if (result.error) console.error(`lint-plugins: ${result.error.message}`)
  if (result.status !== 0) status = result.status ?? 1
}
process.exit(status)
