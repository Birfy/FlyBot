// Prints the CHANGELOG.md section for one version (e.g. 0.1.5), for the release notes.
// Exits 1 when the changelog has no section for it.
import { readFileSync } from 'node:fs'

const version = process.argv[2]
const lines = readFileSync('CHANGELOG.md', 'utf8').split('\n')
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`))
if (!version || start < 0) { console.error(`CHANGELOG.md has no "## [${version}]" section`); process.exit(1) }
const end = lines.findIndex((l, i) => i > start && l.startsWith('## ['))
console.log(lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim())
