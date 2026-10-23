# RSI baseline: the measurement protocol

Issue [#791](https://github.com/ThinkFlowLab/FlyBot/issues/791). This is the first measurement
protocol for the RSI baseline, deliberately small: two metric groups, GitHub as the only source of
truth, and no claim that anything improved. It exists so that a later experiment has something
honest to compare against.

The generated daily reports live in [`docs/reports/`](reports/); the first one is
[`2026-10-22-rsi-baseline.md`](reports/2026-10-22-rsi-baseline.md).

## The two groups

1. **Daily Issue/PR throughput** — Issues opened and closed; PRs opened, merged, and closed without
   merge; net open workload at the end of the day where the API can support it.
2. **Daily CI outcomes** — runs by conclusion, and the success rate as
   `success / (success + failure + cancelled + other)`, with `pull_request` runs and `merge_group`
   runs reported separately. `skipped` has its own column and stays out of the denominator, as
   `unknown` does.

Nothing else is measured yet: task cycle time, review quality, defect escape rate, human
intervention, token/cost attribution and statistical significance are explicitly out of scope until
a concrete experiment needs them.

## Rules the report follows

- **A terminal event is progress.** An Issue counts when it is closed, a PR when it is merged or
  closed without merge. A label change, a claim, an assignment or "turned into a PR" is not counted:
  those are activity, not completion.
- **Throughput counts entities, CI counts runs.** A workflow retried twice is two runs and one pull
  request. The report never divides one by the other.
- **A green head run is not a green queue.** `pull_request` and `merge_group` rows are separate; the
  `all` row exists for completeness and is not evidence about the merge path.
- **Unknown is not zero.** A search count the API marks incomplete, a closed run with no conclusion
  yet, or a metric that could not be read prints as `unknown/not available`. A day with no CI data
  shows no rate at all rather than `0%`.
- **A skipped run measured nothing.** `skipped` means the workflow completed without running what it
  measures — a `needs:` guard said no, or nothing matched. It has its own column and, like `unknown`,
  is out of the denominator: counting it as either a success or a failure would let a day of "did not
  run" move the number.
- **A capped listing is a floor, not a total.** A listing is read up to 20 pages of 100. When page 20
  comes back full the report prints `at least 2000 …, possibly truncated` for that repository and
  says the counts above are a lower bound; a page that comes back short means the list ended and
  nothing is marked. A truncated run still exits 0 — the marker, not the exit code, is the signal.
- **Every report names its window, timezone and repositories.** The default day is the previous UTC
  day, half-open `[00:00, 24:00)`. A fixed offset (`--offset +08:00`) is supported; a named zone is
  refused, because a DST day is 23 or 25 hours long and an implicit day length is not auditable.
- **Every number links to its source.** Run-level links are listed in the report (capped, with the
  API query for the full day), and the formulas sit under each table.
- **Repeated attempts are not repeat PRs.** `head_sha` and PR numbers are never counted twice in
  throughput; they are not deduplicated in CI, where each run is a fact.

## Running it

```sh
GITHUB_TOKEN=<read-only token> node .github/scripts/rsi-baseline.mjs \
  --repo ThinkFlowLab/FlyBot --repo Birfy/FlyBot \
  --day 2026-10-22 \
  --out docs/reports/2026-10-22-rsi-baseline.md
```

`--day` defaults to the previous UTC day, `--offset` takes a fixed offset such as `+08:00`, and
`--repo` may be repeated: issue activity lives upstream while PR and CI activity lives on the fork,
so a single number spanning both would be a fiction. `RSI_BASELINE_NOTES=a|b` adds hand-written
notes (each `|`-separated item becomes a bullet) for facts the numbers cannot express.

Token scope: read-only `issues`, `pulls` and `actions` on the repositories named. The script writes
nothing to GitHub.

## The deterministic test

`node --test .github/scripts/rsi-baseline.test.mjs` (part of the `package` job's
`Tests of the repo scripts` step) checks the formulas on hand-written fixtures, not on live data:

- the day is half-open in UTC, and an offset moves both boundaries;
- throughput counts terminal events only, and a merged PR is not also counted as closed unmerged;
- cancelled runs stay in the denominator, a run with no conclusion does not, and an in-progress run
  is not counted at all;
- a skipped run is its own bucket and stays out of the denominator (3 success + 2 skipped is
  `skipped: 2`, denominator 3, rate `3/3 = 100.0%`);
- a 20-page sequence that ends on a full page is marked truncated, 1999 items are not, and a short
  page stops the walk instead of reading on;
- the report carries the `Skipped` column, names the exclusion in its formula, and prints the
  truncation marker only for a repository whose listing was capped;
- a retried workflow is two runs and one PR;
- per-event rates keep `merge_group` apart from `pull_request`;
- missing data prints as `unknown/not available`, and an empty denominator is not `0%`;
- the rendered report states its window, timezone, repositories and that it claims no improvement.

## First baseline

The 2026-10-22 report is the starting point: 65 Issues opened and 69 closed upstream, 78 PRs opened
and 68 merged, and 825 upstream workflow runs with a 92.8% success rate overall (95.5% on PR heads,
85.5% on queue entries). The rate reads 92.8%, not the 87.3% the first cut of this report printed,
because its denominator is now the 776 runs that produced an outcome instead of 825: the 49 `skipped`
runs measured nothing and are their own column. Those numbers describe the day; they do not describe
a healthy process, and the report says nothing about whether any change made them better. The fork
ran no workflows that day, and its row is `unknown/not available` rather than a zero that would
flatter the rate.
