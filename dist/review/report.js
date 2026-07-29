function location(path, line) {
    return path ? `\`${path}${line === null ? "" : `:${line}`}\`` : "(general)";
}
export function formatPriorFeedbackMatrix(checks) {
    const lines = [
        "## Mandatory Prior-Feedback Matrix",
        "Every row below MUST appear in the final review report with a disposition of **Open**, **Fixed**, " +
            "or **Not applicable**. A row may be marked **Fixed** only after inspecting the current source and " +
            "identifying a commit dated after the comment. Do not infer a disposition from a PR reply, commit title, " +
            "or review-summary text. If no commit landed after the comment, it remains **Open**.",
        "",
    ];
    if (checks.length === 0) {
        lines.push("(no inline review comments found)");
    }
    else {
        lines.push("| Comment | Author | Location | Created | Required final-report disposition |");
        lines.push("| --- | --- | --- | --- | --- |");
        for (const { comment } of checks) {
            const body = comment.body.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
            lines.push(`| \`${comment.id}\` — ${body} | ${comment.author} | ${location(comment.path, comment.line)} | ` +
                `${comment.createdAt} | **UNVERIFIED** |`);
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
