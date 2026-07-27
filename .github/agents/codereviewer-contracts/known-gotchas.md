# Known Gotchas (learned from real reviews)

Referenced from `CodeReviewer.agent.md`. Read before starting any review —
these are concrete misses caught in prior sessions, each with the fix that
prevents recurrence.

- **Narrowing a re-review to only the user's named concern instead of
  running a full fresh checklist pass.** Observed on PR #1491: asked to
  confirm one specific fix (knowledge-dir restoration), this agent verified
  only that item and reported "all clear" — missing 4 other still-open bot
  findings on the same current head: a duplicate stale-schema block in two
  agent files (`search_aliases`/`qa_squad_map` keys no longer present in
  `product-map.json`), an unnecessary `actions: write` workflow permission,
  a `tee`-captured evidence log silently dropping stderr (no `2>&1`), and a
  `task_id` derived from `GITHUB_RUN_ID` that can't correlate across
  workflow runs as claimed. None of these were related to the thing asked
  about, so a scoped check never surfaced them. See Hard Rule 8: any
  re-review of a PR with new commits since your last pass must re-run the
  full Cross-Reference/Framework-Layering checklists and re-list all
  bot/human comments, even when the user's question only names one item.
- **Re-reviewing against a stale local checkout instead of the PR's true
  current head.** Observed on PR #1491: a local branch (`pr1491-review-v2`)
  was checked out once, then reused across three later re-review passes
  without re-fetching. The author pushed a "Remove unwanted product maps"
  commit followed by a revert, plus a dead-code file deletion, but the local
  checkout still pointed at the commit *before* the revert — so a real
  BLOCKER was reported as still-open when it had already been fixed two
  commits earlier. `git checkout`/`cd` into an existing local clone never
  errors on staleness, so this is silent. Always `git fetch origin
  <branch>` + reset to `origin/<branch>` (or re-clone fresh) at the start
  of Workflow step 0, and confirm the resulting local HEAD sha matches
  `gh pr view <n> --json headRefOid` before trusting any diff.
- **Posting summary-only when findings had file:line, skipping
  `buildReviewPayload` entirely.** Observed across a whole batch of
  reviews: every post used `gh api repos/<o>/<r>/pulls/<n>/reviews -f
  body=... -f event=...` directly, which has no `comments` field, so every
  BLOCKER/WARNING/SUGGESTION landed only as body text in one conversation
  comment instead of anchored inline at its file:line — even though
  `buildReviewPayload` exists specifically to produce a payload with a
  `comments` array for this. Always build the `Finding[]` list and run it
  through `buildReviewPayload` before posting (see Workflow step 7); only
  skip it when literally every finding is whole-file/cross-cutting.
- `gh api --paginate` concatenates JSON arrays across pages with no
  separator — `fetchPrReviews()` manually scans bracket-depth to split
  pages before `JSON.parse`.
- `buildReviewPayload` argument order is `(findings, summaryBody, verdict,
  commitId, diff)` — getting this wrong silently produces a payload with
  `commit_id` set to summary text and comments literally saying "undefined".
- The `edit` tool's string match can silently fail on large/duplicated
  multi-line blocks — fall back to a small Python `str.replace()` script via
  `bash` when that happens.
- A bot review comment can land seconds after the PR's last commit, after
  this agent has already snapshotted comments/commits for review — always
  re-check right before finalizing (see Hard Rule 7), don't trust a single
  snapshot taken at the start of a long review.
- Duplicated Maven plugin executions across sibling modules (same `<id>`,
  same early phase) in one PR is an easy miss on a first pass since each
  `pom.xml` diff hunk looks correct in isolation — only shows up when
  grepping the execution `<id>` across all modules at once.
