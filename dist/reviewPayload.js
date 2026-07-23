// Builds a `gh api repos/<owner>/<repo>/pulls/<n>/reviews -X POST` payload from
// a structured list of findings, so inline comments land on the correct
// file:line per the review-pr-operations skill's mechanics. This module only
// PRODUCES the JSON payload — it never calls the GitHub API itself. Posting
// remains an explicit, separate step taken by the calling agent via `gh`,
// only after the human has confirmed the findings.
/**
 * Parses a unified diff (as returned by `gh pr diff`) into a map of
 * file path -> set of line numbers (in the NEW file) that are valid targets
 * for a `side: "RIGHT"` review comment (i.e. lines that appear in a diff
 * hunk — added or unchanged context lines within the hunk range).
 */
export function parseDiffLineMap(diff) {
    const map = new Map();
    const lines = diff.split("\n");
    let currentFile = null;
    let newLineNo = 0;
    const fileHeaderRe = /^\+\+\+ b\/(.+)$/;
    const hunkHeaderRe = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
    for (const line of lines) {
        const fileMatch = fileHeaderRe.exec(line);
        if (fileMatch) {
            currentFile = fileMatch[1] === "/dev/null" ? null : fileMatch[1];
            continue;
        }
        const hunkMatch = hunkHeaderRe.exec(line);
        if (hunkMatch) {
            newLineNo = parseInt(hunkMatch[1], 10);
            continue;
        }
        if (!currentFile)
            continue;
        if (line.startsWith("+")) {
            if (!map.has(currentFile))
                map.set(currentFile, new Set());
            map.get(currentFile).add(newLineNo);
            newLineNo++;
        }
        else if (line.startsWith(" ")) {
            if (!map.has(currentFile))
                map.set(currentFile, new Set());
            map.get(currentFile).add(newLineNo);
            newLineNo++;
        }
        else if (line.startsWith("-")) {
            // Removed line — doesn't exist in the new file, doesn't advance newLineNo.
        }
        else if (line.startsWith("\\")) {
            // "\ No newline at end of file" — ignore.
        }
        else {
            // Any other line (e.g. "diff --git", "index ...") — ignore, doesn't affect counters.
        }
    }
    return map;
}
function severityPrefix(severity) {
    switch (severity) {
        case "BLOCKER":
            return "❌ **BLOCKER**";
        case "WARNING":
            return "⚠️ **WARNING**";
        case "SUGGESTION":
            return "💡 **SUGGESTION**";
    }
}
function formatCommentBody(finding) {
    let body = `${severityPrefix(finding.severity)}: ${finding.message}`;
    if (finding.suggestion) {
        body += `\n\n\`\`\`suggestion\n${finding.suggestion}\n\`\`\``;
    }
    return body;
}
/**
 * Builds a review payload with one inline comment per finding that has a
 * valid, in-diff file:line, per review-pr-operations skill §1 mechanics.
 * Findings without a line, or whose line isn't part of the diff (would
 * cause a 422 from GitHub), are folded into the summary body instead of
 * being dropped, and reported back via `foldedIntoBody`.
 */
export function buildReviewPayload(findings, summaryBody, verdict, commitId, diff) {
    const lineMap = parseDiffLineMap(diff);
    const comments = [];
    const foldedIntoBody = [];
    for (const finding of findings) {
        if (finding.line === undefined) {
            foldedIntoBody.push({ finding, reason: "no file:line given (whole-file/cross-cutting finding)" });
            continue;
        }
        const validLines = lineMap.get(finding.file);
        if (!validLines || !validLines.has(finding.line)) {
            foldedIntoBody.push({
                finding,
                reason: `${finding.file}:${finding.line} is not part of the diff (not addressable via the reviews API — would 422)`,
            });
            continue;
        }
        comments.push({
            path: finding.file,
            line: finding.line,
            side: "RIGHT",
            body: formatCommentBody(finding),
        });
    }
    let body = summaryBody;
    if (foldedIntoBody.length > 0) {
        body += "\n\n### Additional findings (not attachable to a specific diff line)\n";
        for (const { finding, reason } of foldedIntoBody) {
            body += `- ${severityPrefix(finding.severity)} [${finding.file}${finding.line ? ":" + finding.line : ""}] ${finding.message} _(${reason})_\n`;
        }
    }
    return {
        payload: { commit_id: commitId, event: verdict, body, comments },
        foldedIntoBody,
    };
}
/** Fallback payload with no comments[] — used when the full inline submission
 * itself is rejected (e.g. a 422 on a comment we thought was valid). */
export function buildSummaryOnlyPayload(findings, summaryBody, verdict, commitId) {
    let body = summaryBody;
    if (findings.length > 0) {
        body += "\n\n### Findings\n";
        for (const finding of findings) {
            body += `- ${severityPrefix(finding.severity)} [${finding.file}${finding.line ? ":" + finding.line : ""}] ${finding.message}\n`;
        }
    }
    return { commit_id: commitId, event: verdict, body, comments: [] };
}
