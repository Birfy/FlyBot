# Release runbook: the fork publishes, upstream follows

Every version is published twice: the fork `Birfy/FlyBot` cuts it, and upstream `ThinkFlowLab/FlyBot`
is fast-forwarded to the fork's `main` and gets the same release. The second half needs the ruleset
that protects upstream `main` switched off for a moment, so it is one window per version — never a
second one later, and never a window that only moves `main` without the tag.

This page is the sequence, written down so a run does not depend on the Bot that ran it last. The
read-only half is a script: `node .github/scripts/upstream-sync.mjs --check`.

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

Do these before touching the ruleset. Nothing here writes.

```sh
# both mains
curl -sS https://api.github.com/repos/ThinkFlowLab/FlyBot/git/ref/heads/main \
  -H "authorization: Bearer $GITHUB_TOKEN" | jq -r .object.sha
curl -sS https://api.github.com/repos/Birfy/FlyBot/git/ref/heads/main \
  -H "authorization: Bearer $GITHUB_TOKEN" | jq -r .object.sha

# how far the fork is ahead, and nothing else: ahead_by is the fast-forward distance
curl -sS "https://api.github.com/repos/ThinkFlowLab/FlyBot/compare/<upstream-main>...<fork-main>" \
  -H "authorization: Bearer $GITHUB_TOKEN" | jq '{status, ahead_by, behind_by}'

# the ruleset, saved before anything changes — this file is what the restore is compared against
curl -sS https://api.github.com/repos/ThinkFlowLab/FlyBot/rulesets/25173372 \
  -H "authorization: Bearer $GITHUB_TOKEN" > ruleset-25173372.before.json
jq '{id, name, target, enforcement, bypass_actors, current_user_can_bypass, conditions, rules}' \
  ruleset-25173372.before.json
```

The one script form of the same reads, with the exit code doing the judging:

```sh
node .github/scripts/upstream-sync.mjs --check
```

It prints both `main` SHAs, `ahead_by`/`behind_by` and the ruleset row, and exits 0 only when both
mains are the same commit and the ruleset is `active` with an empty `bypass_actors`. Before the
window it exits nonzero (the fork is ahead — that is the push to do); after the window it is the
post-check.

## The window

One window, and the restore in a `finally` so no failure path can leave `main` unprotected. The
sequence below is what ran for `v0.2.5` on 2026-10-23.

```sh
# 1. the writable body, built from the snapshot so nothing but enforcement can drift
jq '{name, target, enforcement: "disabled", bypass_actors, conditions, rules}' \
  ruleset-25173372.before.json > ruleset.disabled.json
curl -sS -X PUT https://api.github.com/repos/ThinkFlowLab/FlyBot/rulesets/25173372 \
  -H "authorization: Bearer $GITHUB_TOKEN" -H 'content-type: application/json' \
  --data @ruleset.disabled.json | jq -r .enforcement    # expect: disabled

# 2. fast-forward; force:false makes the API refuse anything that is not a fast-forward
curl -sS -X PATCH https://api.github.com/repos/ThinkFlowLab/FlyBot/git/refs/heads/main \
  -H "authorization: Bearer $GITHUB_TOKEN" -H 'content-type: application/json' \
  --data '{"sha":"<fork-main>","force":false}' | jq -r .object.sha

# 3. restore, in the same run — always, including after a failed push
jq '{name, target, enforcement, bypass_actors, conditions, rules}' \
  ruleset-25173372.before.json > ruleset.restore.json
curl -sS -X PUT https://api.github.com/repos/ThinkFlowLab/FlyBot/rulesets/25173372 \
  -H "authorization: Bearer $GITHUB_TOKEN" -H 'content-type: application/json' \
  --data @ruleset.restore.json | jq -r .enforcement     # expect: active
```

**A ruleset update is `PUT`. `PATCH` returns 404 every time.** It reads like "no such ruleset" and
it is not: the same `GET` right before answered 200.

### The post-check: the restore is verified, not assumed

```sh
# what the ruleset says now, compared with the file saved before the window
curl -sS https://api.github.com/repos/ThinkFlowLab/FlyBot/rulesets/25173372 \
  -H "authorization: Bearer $GITHUB_TOKEN" \
  | jq -e '.enforcement == "active" and (.bypass_actors | length) == 0 and .current_user_can_bypass == "never"'

# and the whole picture, including both mains
node .github/scripts/upstream-sync.mjs --check
```

The `jq -e` line is the one command that proves the restore: it fails loudly when `main` is left
unprotected or the bypass list came back non-empty. `upstream-sync --check` then confirms the push
landed. Do not close the window on "it printed `active`" alone — a restore that wrote a different
body also prints `active`.

## The write path, and the permission it needs

From a Bot box the write path is the REST API: `PATCH /repos/{owner}/{repo}/git/refs/heads/main`
with the token in `authorization`, as above. `api.github.com` answers; a plain
`git push https://github.com/...` from that box has been the unreliable one, and `gh` dies on
`x509: certificate signed by unknown authority` there, which is why the calls above are `curl`.

The token needs **admin on `ThinkFlowLab/FlyBot`** to touch the ruleset and the ref. Without it the
ref update answers `403`, and the ruleset endpoints answer `404` — GitHub reports a resource the
token may not administer as missing. So a 404 on a ruleset the preflight just read is a permission
answer, not a deletion; the check script says `ruleset 25173372 cannot be read: HTTP 404` and names
the id for exactly this reason.

## When the push fails after the disable

Restore first, diagnose second. The window must never outlive the attempt:

1. Run the restore call from step 3, then the `jq -e` post-check. If it fails, say so loudly and do
   not retry the push — an unprotected `main` is the incident, a late release is not.
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
