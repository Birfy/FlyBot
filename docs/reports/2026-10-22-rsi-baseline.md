# RSI baseline — 2026-10-22

Window: `2026-10-22T00:00:00.000Z` to `2026-10-23T00:00:00.000Z` (half-open, UTC; default UTC).
Repositories: `ThinkFlowLab/FlyBot`, `Birfy/FlyBot`. Generated 2026-10-23T07:26:44.832Z from the GitHub REST API.

This is a baseline record. It claims no improvement: it has no experiment, no comparison and no pass/fail threshold.

## 1. Daily Issue/PR throughput

| Repository | Issues opened | Issues closed | PRs opened | PRs merged | PRs closed unmerged | Net open issues | Net open PRs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ThinkFlowLab/FlyBot` | 65 | 69 | 78 | 68 | 12 | 50 | 31 |
| `Birfy/FlyBot` | 0 | 0 | 0 | 0 | 0 | 0 | 16 |

Formulas: a count is the number of those entities whose terminal timestamp falls inside the window; `closed unmerged` requires `closed_at` inside the window and `merged_at` empty; `net open` is `created before the end of the window - closed before the end of the window`, computed from search counts and shown as unknown when a count is unavailable. A labelled, claimed or converted Issue is not counted as processed.

## 2. Daily CI outcomes

| Repository | Event | Runs | Success | Failure | Cancelled | Skipped | Other | Unknown | Success rate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ThinkFlowLab/FlyBot` | pull_request | 515 | 492 | 23 | 0 | 0 | 0 | 0 | 492/515 = 95.5% |
| `ThinkFlowLab/FlyBot` | merge_group | 152 | 130 | 22 | 0 | 0 | 0 | 0 | 130/152 = 85.5% |
| `ThinkFlowLab/FlyBot` | push | 66 | 59 | 7 | 0 | 0 | 0 | 0 | 59/66 = 89.4% |
| `ThinkFlowLab/FlyBot` | other | 92 | 39 | 4 | 0 | 49 | 0 | 0 | 39/43 = 90.7% |
| `ThinkFlowLab/FlyBot` | **all** | 825 | 720 | 56 | 0 | 49 | 0 | 0 | 720/776 = 92.8% |
| `Birfy/FlyBot` | **all** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | unknown/not available |

Formulas: `runs` counts runs whose `created_at` is inside the window, not unique PRs, so a retried workflow is two runs; `unknown` is a completed run with no conclusion, `skipped` is a run that measured nothing, and `other` is any conclusion outside success/failure/cancelled/skipped; the denominator is `success + failure + cancelled + other` (cancelled runs stay in it; `skipped` and `unknown` do not); an empty denominator prints as unknown rather than 0%. `merge_group` runs are the queue, `pull_request` runs are the head; a green head run is not evidence about the queue.

### Source runs

- `ThinkFlowLab/FlyBot` [Controller (labels only) 39866790739](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39866790739) — schedule, failure
- `ThinkFlowLab/FlyBot` [Label hygiene 39866507450](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39866507450) — schedule, failure
- `ThinkFlowLab/FlyBot` [Pass label 39862923912](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39862923912) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39862501748](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39862501748) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Test 39862447441](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39862447441) — pull_request, failure
- `ThinkFlowLab/FlyBot` [Merge gate 39862447321](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39862447321) — pull_request, failure
- `ThinkFlowLab/FlyBot` [Risk tier (report only) 39862447405](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39862447405) — pull_request, success
- `ThinkFlowLab/FlyBot` [Review gate (report only) 39862447328](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39862447328) — pull_request, success
- `ThinkFlowLab/FlyBot` [Pass label 39862237701](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39862237701) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39862175084](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39862175084) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39862028882](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39862028882) — issue_comment, failure
- `ThinkFlowLab/FlyBot` [Pass label 39861978417](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39861978417) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39861974480](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39861974480) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Test 39861365909](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39861365909) — push, failure
- `ThinkFlowLab/FlyBot` [Merge gate 39861137491](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39861137491) — merge_group, success
- `ThinkFlowLab/FlyBot` [Test 39861137563](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39861137563) — merge_group, success
- `ThinkFlowLab/FlyBot` [Pass label 39861055893](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39861055893) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Test 39860419391](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39860419391) — push, success
- `ThinkFlowLab/FlyBot` [Test 39860118547](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39860118547) — merge_group, success
- `ThinkFlowLab/FlyBot` [Merge gate 39860118506](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39860118506) — merge_group, success
- `ThinkFlowLab/FlyBot` [Pass label 39860057333](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39860057333) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Pass label 39859606849](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859606849) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39859484490](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859484490) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39859337836](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859337836) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39859308319](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859308319) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39859304234](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859304234) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39859304524](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859304524) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39859300292](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859300292) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39859256744](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859256744) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39859251520](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859251520) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39859252605](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859252605) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39859248638](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859248638) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39859203458](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859203458) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Risk tier (report only) 39859037454](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859037454) — pull_request, success
- `ThinkFlowLab/FlyBot` [Merge gate 39859037457](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859037457) — pull_request, success
- `ThinkFlowLab/FlyBot` [Review gate (report only) 39859037746](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859037746) — pull_request, success
- `ThinkFlowLab/FlyBot` [Test 39859037546](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39859037546) — pull_request, success
- `ThinkFlowLab/FlyBot` [Release 39858772678](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39858772678) — push, success
- `ThinkFlowLab/FlyBot` [Test 39858754220](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39858754220) — push, success
- `ThinkFlowLab/FlyBot` [Test 39858513495](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39858513495) — merge_group, success
- `ThinkFlowLab/FlyBot` [Merge gate 39858513468](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39858513468) — merge_group, success
- `ThinkFlowLab/FlyBot` [Test 39858508811](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39858508811) — pull_request, success
- `ThinkFlowLab/FlyBot` [Merge gate 39858508827](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39858508827) — pull_request, success
- `ThinkFlowLab/FlyBot` [Review gate (report only) 39858508820](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39858508820) — pull_request, success
- `ThinkFlowLab/FlyBot` [Risk tier (report only) 39858508828](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39858508828) — pull_request, success
- `ThinkFlowLab/FlyBot` [Merge gate 39858174657](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39858174657) — pull_request, success
- `ThinkFlowLab/FlyBot` [Review gate (report only) 39858174800](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39858174800) — pull_request, success
- `ThinkFlowLab/FlyBot` [Risk tier (report only) 39858174883](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39858174883) — pull_request, success
- `ThinkFlowLab/FlyBot` [Test 39858174944](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39858174944) — pull_request, success
- `ThinkFlowLab/FlyBot` [Test 39857793771](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39857793771) — merge_group, success
- `ThinkFlowLab/FlyBot` [Merge gate 39857793819](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39857793819) — merge_group, success
- `ThinkFlowLab/FlyBot` [Pass label 39857726983](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39857726983) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Live E2E 39846984282](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39846984282) — schedule, failure
- `ThinkFlowLab/FlyBot` [Compatibility 39843638399](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39843638399) — schedule, success
- `ThinkFlowLab/FlyBot` [Controller (labels only) 39840169993](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39840169993) — schedule, success
- `ThinkFlowLab/FlyBot` [Controller (labels only) 39806308900](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39806308900) — schedule, success
- `ThinkFlowLab/FlyBot` [Test 39803339755](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39803339755) — push, success
- `ThinkFlowLab/FlyBot` [Merge gate 39803031084](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39803031084) — merge_group, success
- `ThinkFlowLab/FlyBot` [Test 39803031032](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39803031032) — merge_group, success
- `ThinkFlowLab/FlyBot` [Test 39803025850](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39803025850) — push, success
- `ThinkFlowLab/FlyBot` [Pass label 39801581636](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39801581636) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Test 39801424138](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39801424138) — merge_group, success
- `ThinkFlowLab/FlyBot` [Merge gate 39801424717](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39801424717) — merge_group, success
- `ThinkFlowLab/FlyBot` [Test 39801419347](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39801419347) — push, success
- `ThinkFlowLab/FlyBot` [Pass label 39801200686](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39801200686) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Review gate (report only) 39801051127](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39801051127) — pull_request, success
- `ThinkFlowLab/FlyBot` [Test 39801050949](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39801050949) — pull_request, failure
- `ThinkFlowLab/FlyBot` [Risk tier (report only) 39801050956](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39801050956) — pull_request, success
- `ThinkFlowLab/FlyBot` [Merge gate 39801050929](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39801050929) — pull_request, success
- `ThinkFlowLab/FlyBot` [Pass label 39800769128](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39800769128) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Pass label 39800303567](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39800303567) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Merge gate 39800259244](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39800259244) — merge_group, success
- `ThinkFlowLab/FlyBot` [Test 39800259252](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39800259252) — merge_group, success
- `ThinkFlowLab/FlyBot` [Pass label 39799927598](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39799927598) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39799924254](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39799924254) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Pass label 39799804253](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39799804253) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Risk tier (report only) 39799757370](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39799757370) — pull_request, success
- `ThinkFlowLab/FlyBot` [Review gate (report only) 39799757350](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39799757350) — pull_request, success
- `ThinkFlowLab/FlyBot` [Merge gate 39799757514](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39799757514) — pull_request, success
- `ThinkFlowLab/FlyBot` [Test 39799757617](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39799757617) — pull_request, success
- `ThinkFlowLab/FlyBot` [Pass label 39799736415](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39799736415) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Pass label 39799671006](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39799671006) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39799543979](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39799543979) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Pass label 39798694804](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39798694804) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Merge gate 39798654847](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39798654847) — pull_request, success
- `ThinkFlowLab/FlyBot` [Review gate (report only) 39798654846](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39798654846) — pull_request, success
- `ThinkFlowLab/FlyBot` [Test 39798654962](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39798654962) — pull_request, success
- `ThinkFlowLab/FlyBot` [Risk tier (report only) 39798654810](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39798654810) — pull_request, success
- `ThinkFlowLab/FlyBot` [Pass label 39798132020](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39798132020) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Test 39797987900](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39797987900) — pull_request, success
- `ThinkFlowLab/FlyBot` [Review gate (report only) 39797987948](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39797987948) — pull_request, success
- `ThinkFlowLab/FlyBot` [Risk tier (report only) 39797987376](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39797987376) — pull_request, success
- `ThinkFlowLab/FlyBot` [Merge gate 39797987410](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39797987410) — pull_request, success
- `ThinkFlowLab/FlyBot` [Pass label 39797832110](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39797832110) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Pass label 39796983177](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39796983177) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Pass label 39796965098](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39796965098) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Merge gate 39795670929](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39795670929) — pull_request, success
- `ThinkFlowLab/FlyBot` [Risk tier (report only) 39795670878](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39795670878) — pull_request, success
- `ThinkFlowLab/FlyBot` [Test 39795670835](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39795670835) — pull_request, success
- `ThinkFlowLab/FlyBot` [Review gate (report only) 39795670784](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39795670784) — pull_request, success
- `ThinkFlowLab/FlyBot` [Pass label 39795178465](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39795178465) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39795027842](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39795027842) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39794933598](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794933598) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39794928884](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794928884) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Pass label 39794926038](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794926038) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39794915364](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794915364) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Merge gate 39794875671](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794875671) — pull_request, success
- `ThinkFlowLab/FlyBot` [Test 39794876101](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794876101) — pull_request, success
- `ThinkFlowLab/FlyBot` [Review gate (report only) 39794876502](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794876502) — pull_request, success
- `ThinkFlowLab/FlyBot` [Risk tier (report only) 39794875441](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794875441) — pull_request, success
- `ThinkFlowLab/FlyBot` [Test 39794775824](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794775824) — pull_request, success
- `ThinkFlowLab/FlyBot` [Risk tier (report only) 39794776209](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794776209) — pull_request, success
- `ThinkFlowLab/FlyBot` [Merge gate 39794776462](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794776462) — pull_request, success
- `ThinkFlowLab/FlyBot` [Review gate (report only) 39794776403](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794776403) — pull_request, success
- `ThinkFlowLab/FlyBot` [Pass label 39794608766](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794608766) — issue_comment, skipped
- `ThinkFlowLab/FlyBot` [Pass label 39794602830](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794602830) — issue_comment, success
- `ThinkFlowLab/FlyBot` [Merge gate 39794558716](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794558716) — pull_request, success
- `ThinkFlowLab/FlyBot` [Test 39794558591](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794558591) — pull_request, success
- `ThinkFlowLab/FlyBot` [Risk tier (report only) 39794558678](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794558678) — pull_request, success
- `ThinkFlowLab/FlyBot` [Review gate (report only) 39794558741](https://github.com/ThinkFlowLab/FlyBot/actions/runs/39794558741) — pull_request, success
- 705 more runs of this day are not listed; the full list per repository is `GET https://api.github.com/repos/<owner>/<name>/actions/runs?created=2026-10-22`.

### Notes

- `#794` was closed by the cross-repository `Fixes` line on a pull request whose run measured nothing, then reopened by Triage. It is counted as closed in the raw issue counts for the day; that is a workflow fact, not a measure of progress.
- The upstream repository Actions were locked for billing on this day, so its runs carry no steps. They are counted as failures exactly as the API reports them, without reinterpreting them.

