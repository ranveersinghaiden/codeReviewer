function location(path, line) {
    return path ? `\`${path}${line === null ? "" : `:${line}`}\`` : "(general)";
}
function threadState(comment) {
    if (comment.threadId === null) {
        return "**UNAVAILABLE**";
    }
    const resolution = comment.isThreadResolved ? "Resolved" : "Open";
    const anchor = comment.isThreadOutdated ? "outdated" : "current";
    return `${resolution}, ${anchor}`;
}
export function formatPriorFeedbackMatrix(checks) {
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
    }
    else {
        lines.push("| Comment | Author | Location | GitHub thread state | Created | Required final-report disposition |");
        lines.push("| --- | --- | --- | --- | --- | --- |");
        for (const { comment } of checks) {
            const body = comment.body.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
            const kind = comment.isReply ? "reply" : "feedback";
            lines.push(`| \`${comment.id}\` (${kind}) — ${body} | ${comment.author} | ${location(comment.path, comment.line)} | ` +
                `${threadState(comment)} | ${comment.createdAt} | **UNVERIFIED** |`);
        }
    }
    lines.push("");
    return lines;
}
export function formatDuplicateSimilarityMatrix(checks) {
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
        lines.push(check.isCode
            ? `| \`${check.path}\` | **UNVERIFIED** — search existing implementations |`
            : `| \`${check.path}\` | **N/A** — non-code file; include the reason in the final report |`);
    }
    lines.push("");
    return lines;
}
export function formatWorkflowShellMatrix(checks) {
    if (checks.length === 0)
        return [];
    const lines = [
        "## Mandatory Workflow Shell Structure Check",
        "The rows below are source-only structural analysis of changed `run: |` blocks; no PR code was executed. " +
            "Every reported issue MUST be inspected against the full workflow and recorded through " +
            "`finalize_reviewer_findings` unless it is demonstrably a false positive. Do not substitute a thematic " +
            "workflow review for this matrix.",
        "",
        "| Workflow | Static result | Required final-report action |",
        "| --- | --- | --- |",
    ];
    for (const check of checks) {
        if (check.unavailableReason) {
            lines.push(`| \`${check.path}\` | **INCOMPLETE** — ${check.unavailableReason} | Inspect manually |`);
        }
        else if (check.findings.length === 0) {
            lines.push(`| \`${check.path}\` | Passed structural scan | State inspected evidence |`);
        }
        else {
            const findings = check.findings.map((finding) => `line ${finding.line}: ${finding.message}`).join("<br>");
            lines.push(`| \`${check.path}\` | **FINDINGS** — ${findings} | Reconcile each finding in the ledger |`);
        }
    }
    lines.push("");
    return lines;
}
export function formatReviewerFindingLedger(findings) {
    const lines = [
        "## Mandatory Reviewer-Finding Ledger",
        "These are findings made by this reviewer in earlier passes, separate from GitHub comments. Before issuing a " +
            "verdict, finalize every **Open** row through `finalize_reviewer_findings` with an explicit disposition: " +
            "**Open**, **Fixed**, **Superseded**, or **Not PR-unique**. The tool rejects a verdict workflow that omits " +
            "an earlier Open finding, refreshes the PR head and GitHub review-ID snapshot, and returns the only " +
            "report-ready reviewer-finding set. Set `review_mode` from the gathered scope: a **delta** finalization " +
            "is not approval eligible. Mark **Fixed** only with current source and later-commit evidence; use " +
            "**Superseded** only when a replacement finding is also recorded.",
        "",
    ];
    if (findings.length === 0) {
        lines.push("(no reviewer-originated findings recorded for this PR yet)");
    }
    else {
        lines.push("| Ledger ID | Severity | Location | Disposition | Last reviewed head | Required action |");
        lines.push("| --- | --- | --- | --- | --- | --- |");
        for (const finding of findings) {
            const location = `\`${finding.file}${finding.line === null ? "" : `:${finding.line}`}\``;
            const action = finding.disposition === "Open"
                ? `Reconcile this ID with current evidence: \`${finding.id}\``
                : finding.evidence.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
            lines.push(`| \`${finding.id}\` | ${finding.severity} | ${location} | **${finding.disposition}** | ` +
                `\`${finding.lastReviewedHead.slice(0, 12)}\` | ${action} |`);
        }
    }
    lines.push("");
    return lines;
}
