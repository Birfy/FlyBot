# Release runbook: the fork publishes, upstream follows

Every version is published twice: the fork `Birfy/FlyBot` cuts it, and upstream `ThinkFlowLab/FlyBot`
is fast-forwarded to the fork's `main` and gets the same release. The second half needs the ruleset
that protects upstream `main` switched off for a moment, so it is one window per version — never a
second one later, and never a window that moves `main` without the tag.

This page is the sequence, written down so a run does not depend on the Bot that ran it last. The
read-only half is a script: `node .github/scripts/upstream-sync.mjs --check`.

**The token.** Every command below reads `$TOKEN`, opened once as:

```sh
export TOKEN=${DSH_SECRET_GITHUB_TOKEN:-$GITHUB_TOKEN}
```

On a Bot box `GITHUB_TOKEN` is unset and the secret is `DSH_SECRET_GITHUB_TOKEN`; a `Bearer
$GITHUB_TOKEN` there sends an empty string and every read answers 401 (or 404 on the ruleset, which
`--check` then reports as unreadable). Whichever variable answers has to carry **admin on
`ThinkFlowLab/FlyBot`** — the CI token does not, and it reads the ruleset as 404.

**The tools.** This box has `node` and no `curl` and no `jq` (`command -v curl jq` is empty), and
`git push` to `github.com:443` dies with `GnuTLS recv error (-110)`. So the reads and the three
window calls below are `node --input-type=module -e` snippets against `api.github.com`, not `curl`
pipelines: copy-paste has to work on the machine the runbook is for.

## The six steps, in this order

1. The release pull request lands on the fork and `main`'s `Test` is green.
2. The tag goes on the **release commit**, not on the tip.
3. The fork's `Release` workflow produces the four assets; check the sha256 of each.
4. Re-run the dry-run and its five gates.
5. Open the window: `PUT` the ruleset to disabled → fast-forward with `force: false` → restore in
   `finally` and read the ruleset back.
6. Create the release upstream and upload the same asset bytes.

Why the tag goes on the release commit: the workflow checks the tag out and repacks. A tag on a
later `main` publishes different bytes under the same version number — the same version twice, with
two answers, which is worse than a missing release. Every version leaves the fork ahead again once
the next pull requests land, so this repeats with every version; that is why the window is tied to
the version, not to the merge.

## Preflight: the reads

Nothing here writes. The first two are the script, the third saves the ruleset the restore is
compared against.

```sh
export TOKEN=${DSH_SECRET_GITHUB_TOKEN:-$GITHUB_TOKEN}

# both mains, ahead_by/behind_by, and the ruleset row — exit 0 only when it is already the state a
# restore has to produce, so before the window it exits nonzero with the distance still printed
node .github/scripts/upstream-sync.mjs --check

# the third read: the commits the fast-forward would carry, oldest first
node .github/scripts/upstream-sync.mjs --commits
```

```sh
# the ruleset as it is now — this file is what the restore is compared against
TOKEN="$TOKEN" node --input-type=module -e '
import { writeFileSync } from "node:fs"
const h = { authorization: `Bearer ${process.env.TOKEN}`, accept: "application/vnd.github+json" }
const r = await fetch("https://api.github.com/repos/ThinkFlowLab/FlyBot/rulesets/25173372", { headers: h })
if (r.status !== 200) { console.error(`cannot read the ruleset: HTTP ${r.status}`); process.exit(1) }
const j = await r.json()
writeFileSync("ruleset-25173372.before.json", JSON.stringify(j, null, 2) + "\n")
console.log(`enforcement=${j.enforcement} bypass_actors=${(j.bypass_actors || []).length} current_user_can_bypass=${j.current_user_can_bypass}`)
'
```

The dry-run's five gates (upstream `main` is still the commit the last sync left, that commit is an
ancestor of the fork's, the tagged commit is reached by the fast-forward, the four assets reproduce
digest for digest, upstream has no tag and no release for this version yet) are the release
routine's own script. Re-run it here: a window opened on a stale reading is the failure this
preflight exists to prevent.

## The window

One window, and the restore in a `finally` so no failure path can leave `main` unprotected. Run it as
one block: a half-run window is the incident.

```sh
export TOKEN=${DSH_SECRET_GITHUB_TOKEN:-$GITHUB_TOKEN}
node --input-type=module -e '
import { readFileSync } from "node:fs"
const [T, UP, FORK, ID] = [process.env.TOKEN, "ThinkFlowLab/FlyBot", "Birfy/FlyBot", "25173372"]
const call = async (method, path, body) => {
  const r = await fetch("https://api.github.com" + path, {
    method,
    headers: { authorization: `Bearer ${T}`, accept: "application/vnd.github+json", "content-type": "application/json" },
    body: body && JSON.stringify(body),
  })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const snap = JSON.parse(readFileSync("ruleset-25173372.before.json", "utf8"))
// only the writable fields, copied from the snapshot: nothing but enforcement can drift
const body = (enforcement) => ({ name: snap.name, target: snap.target, enforcement, bypass_actors: snap.bypass_actors, conditions: snap.conditions, rules: snap.rules })
try {
  const fork = (await call("GET", `/repos/${FORK}/git/ref/heads/main`)).json.object.sha
  const off = await call("PUT", `/repos/${UP}/rulesets/${ID}`, body("disabled"))
  console.log("disabled ->", off.status, off.json?.enforcement)
  if (off.status !== 200 || off.json?.enforcement !== "disabled") throw new Error("the window never opened; nothing was pushed")
  const mv = await call("PATCH", `/repos/${UP}/git/refs/heads/main`, { sha: fork, force: false })
  console.log("fast-forward ->", mv.status, mv.json?.object?.sha)
  if (mv.status !== 200) throw new Error(`the push was refused: HTTP ${mv.status}`)
} finally {
  // restore on every path, including a thrown error, and never leave main unprotected
  const on = await call("PUT", `/repos/${UP}/rulesets/${ID}`, body("active"))
  console.log("restore ->", on.status, on.json?.enforcement)
}
'
```

**A ruleset update is `PUT`. `PATCH` returns 404 every time.** It reads like "no such ruleset" and
it is not: the same `GET` right before answered 200.

### The post-check: the restore is verified, not assumed

```sh
export TOKEN=${DSH_SECRET_GITHUB_TOKEN:-$GITHUB_TOKEN}
# the one command that proves the restore: it exits nonzero when main is left unprotected
node --input-type=module -e '
const h = { authorization: `Bearer ${process.env.TOKEN}`, accept: "application/vnd.github+json" }
const r = await fetch("https://api.github.com/repos/ThinkFlowLab/FlyBot/rulesets/25173372", { headers: h })
const j = await r.json()
const state = { enforcement: j.enforcement, bypass_actors: (j.bypass_actors || []).length, current_user_can_bypass: j.current_user_can_bypass }
console.log(JSON.stringify(state))
process.exit(r.status === 200 && state.enforcement === "active" && state.bypass_actors === 0 && state.current_user_can_bypass === "never" ? 0 : 1)
'

# and the whole picture, including both mains
node .github/scripts/upstream-sync.mjs --check
```

Do not close the window on "it printed `active`" alone — a restore that wrote a different body also
prints `active`, which is why the assertion covers the bypass list and `current_user_can_bypass` too,
and why `--check` rereads the ruleset instead of trusting the window's own output.

## The write path, and the permission it needs

From a Bot box the write path is the REST API: `PATCH /repos/{owner}/{repo}/git/refs/heads/main`
with the token in `authorization`, as above. `api.github.com` answers; `git push` to `github.com`
does not (`GnuTLS recv error (-110)`), and `gh` dies on `x509: certificate signed by unknown
authority`. That is why the calls above are `node`, and why the release window never depends on a
shell tool that is not installed.

The token needs **admin on `ThinkFlowLab/FlyBot`** to touch the ruleset and the ref. Without it the
ref update answers `403`, and the ruleset endpoints answer `404` — GitHub reports a resource the
token may not administer as missing. So a 404 on a ruleset the preflight just read is a permission
answer, not a deletion; `--check` prints `ruleset 25173372 cannot be read: HTTP 404` and names the id
for exactly this reason.

## When the push fails after the disable

Restore first, diagnose second. The window must never outlive the attempt:

1. Run the restore call, then the post-check. If the post-check fails, say so loudly and do not retry
   the push — an unprotected `main` is the incident, a late release is not.
2. Only then read the push's error. `422` from the ref update means the fork's `main` is no longer a
   descendant of upstream's (someone else pushed, or the fork moved); `403` means the token is not
   admin. Neither is fixed by `force: true`.
3. Report to the Chief with the two SHAs, the `compare` numbers and the ruleset row, and stop.

**Stop rule:** if the fast-forward ancestry no longer holds — `ahead_by`/`behind_by` do not describe
one straight line from upstream's `main` to the fork's — do not guess and do not force. Stop and
report.

## Reading the two red runs

Pushing the tag starts `release.yml` upstream. Under the billing lock, both the tag run and `main`'s
`Test` are **zero-step, 4-second failures** — that is the lock, not a failed release, and there is
nothing to cancel. Check the steps: a run whose job was never assigned has no steps and no runner
name, which is the lock; a run that failed a step is a release problem. `cancel` acts on runs still
in progress, so it does nothing for either of these. Both stay red until the lock lifts; re-run them
then, and do not delete a release or a tag to make the picture look clean.

## One window per version

The window exists because upstream `main` has `bypass_actors: []` and `current_user_can_bypass:
never` — a deliberate owner decision, not a defect to route around. That protection is worth more
than the ceremony it costs, so the ceremony is written down here instead of loosened: for each
version, one window, both the fast-forward and the tag, and the release created inside it.
