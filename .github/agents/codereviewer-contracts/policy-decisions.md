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
