import type { DuplicateSimilarityCheck, PriorFeedbackCheck } from "./types.js";

function location(path: string, line: number | null): string {
  return path ? `\`${path}${line === null ? "" : `:${line}`}\`` : "(general)";
}

function threadState(comment: PriorFeedbackCheck["comment"]): string {
  if (comment.threadId === null) {
    return "**UNAVAILABLE**";
  }
  const resolution = comment.isThreadResolved ? "Resolved" : "Open";
  const anchor = comment.isThreadOutdated ? "outdated" : "current";
  return `${resolution}, ${anchor}`;
}

export function formatPriorFeedbackMatrix(checks: PriorFeedbackCheck[]): string[] {
  const lines = [
    "## Mandatory Prior-Feedback Matrix",
    "Every row below MUST appear in the final review report with a disposition of **Open**, **Fixed**, " +
      "or **Not applicable**. A row may be marked **Fixed** only after inspecting the current source and " +
      "identifying a commit dated after the comment. GitHub thread state is independent: an **Open** thread can " +
      "be technically fixed, while a resolved thread is not source evidence. Do not infer a disposition from a " +
      "PR reply, commit title, or review-summary text. If no commit landed after the comment, it remains **Open**.",
    "",
  ];
  if (checks.length === 0) {
    lines.push("(no inline review comments found)");
  } else {
    lines.push("| Comment | Author | Location | GitHub thread state | Created | Required final-report disposition |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const { comment } of checks) {
      const body = comment.body.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
      const kind = comment.isReply ? "reply" : "feedback";
      lines.push(
        `| \`${comment.id}\` (${kind}) — ${body} | ${comment.author} | ${location(comment.path, comment.line)} | ` +
          `${threadState(comment)} | ${comment.createdAt} | **UNVERIFIED** |`
      );
    }
  }
  lines.push("");
  return lines;
}

export function formatDuplicateSimilarityMatrix(checks: DuplicateSimilarityCheck[]): string[] {
  const lines = [
    "## Mandatory Per-File Duplicate / Similarity Matrix",
    "For every changed code file below, search the current repository for existing implementations before " +
      "issuing a verdict. Compare the new methods, helpers, queries, step definitions, and workflow logic " +
      "against the containing class/module and relevant sibling modules. The final review report MUST include " +
      "one row per file with the search evidence and disposition. **Exact duplicate behavior or copied " +
      "implementation is a BLOCKER.** **Materially similar behavior that can be reused, parameterized, or " +
      "extracted is a WARNING.** Mark non-code files N/A with a reason. Do not mark a row complete merely " +
      "because a keyword search returned no result.",
    "",
    "| Changed file | Required final-report disposition |",
    "| --- | --- |",
  ];
  for (const check of checks) {
    lines.push(
      check.isCode
        ? `| \`${check.path}\` | **UNVERIFIED** — search existing implementations |`
        : `| \`${check.path}\` | **N/A** — non-code file; include the reason in the final report |`
    );
  }
  lines.push("");
  return lines;
}
