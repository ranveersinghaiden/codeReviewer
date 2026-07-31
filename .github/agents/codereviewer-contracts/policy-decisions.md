# Reviewer Policy Decision Log

This append-only log records policy decisions that affect reviewer behavior.
When a policy changes, update this file and every policy surface in the same
change: the agent contract, applicable checklist, review-context prompt, and
MCP tool description. Refactors must preserve accepted decisions unless a new
entry explicitly supersedes them.

## D-001: Static-only review execution boundary

- **Date:** 2026-07-31
- **Status:** Accepted
- **Decision:** The CodeReviewer agent and its MCP server must not execute,
  build, lint, test, or dry-run PR code. They assess static evidence and,
  where repository policy requires runtime proof, inspect linked CI/manual
  evidence or request it from the author.
- **Rationale:** The review environment is intentionally read-only. Treating
  the reviewer's own non-execution as a defect creates an impossible rule and
  conflicts with the agent's execution boundary.

## D-002: Protected-file process evidence

- **Date:** 2026-07-31
- **Status:** Accepted
- **Decision:** An author's PR-description statement that specifically
  confirms a protected-file change is intentional and verified is sufficient
  process evidence. The CodeReviewer represents the authorized reviewer and
  must not require a second person's approval before issuing a verdict.
- **Rationale:** Process evidence and technical correctness are independent.
  The reviewer must still inspect and enumerate every protected file and
  report unresolved technical or feedback issues.

## D-003: Agent-contract modularity

- **Date:** 2026-07-31
- **Status:** Accepted
- **Decision:** The primary agent contract defines role, hard rules, workflow,
  and references to focused contracts. Detailed checklists, policy decisions,
  and incident examples remain in their dedicated files. A PR must not
  reabsorb a focused contract into the primary agent file or duplicate its
  substantive rules there.
- **Rationale:** Focused contracts are deliberately loaded independently to
  keep the agent's working context manageable and make each policy easier to
  maintain. A line-count threshold alone is insufficient: a concise,
  justified change may be longer, while duplicated policy creates conflicting
  sources of truth at any length.

## D-004: Durable reviewer-finding reconciliation

- **Date:** 2026-07-31
- **Status:** Accepted
- **Decision:** Reviewer-originated findings are persisted locally per PR and
  reconciled before every verdict. Every previously Open finding requires
  current evidence and an explicit disposition: Open, Fixed, Superseded, or
  Not PR-unique.
- **Rationale:** GitHub comment history alone does not preserve findings the
  reviewer reported but did not post. Explicit reconciliation prevents a
  finding from disappearing between re-review passes or being lost to a
  truncated report.

- **Review-round count:** Each successful finalization increments a durable
  per-PR review-round counter. Use it to report the number of complete review
  passes recorded by the reviewer; do not infer rounds from comments or commits.

## D-005: Visible synchronous review execution

- **Date:** 2026-07-31
- **Status:** Accepted
- **Decision:** PR reviews run synchronously, not in background tasks. The
  reviewer provides concise console progress at material phases.
- **Rationale:** The user needs direct visibility into review activity and
  should not have to wait for an opaque background handoff.
