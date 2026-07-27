import { rulesForFiles } from "./rules/index.js";
/** Minimal unified diff parser: extracts added (+) lines with their new-file line numbers. */
export function parseDiff(diffText) {
    const files = [];
    const lines = diffText.split("\n");
    let current = null;
    let newLineNum = 0;
    for (const line of lines) {
        const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
        if (fileMatch) {
            current = { path: fileMatch[1], addedLines: [] };
            files.push(current);
            continue;
        }
        const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkMatch) {
            newLineNum = parseInt(hunkMatch[1], 10);
            continue;
        }
        if (!current)
            continue;
        if (line.startsWith("+") && !line.startsWith("+++")) {
            current.addedLines.push({ line: newLineNum, content: line.slice(1) });
            newLineNum++;
        }
        else if (line.startsWith("-") && !line.startsWith("---")) {
            // removed line, doesn't advance new-file line counter
        }
        else if (!line.startsWith("\\")) {
            newLineNum++;
        }
    }
    return files;
}
const PATTERN_CHECKS = [
    { category: "typescript", regex: /:\s*any\b/, severity: "warning", message: "Avoid `any`; prefer a specific type or `unknown` with narrowing." },
    { category: "typescript", regex: /@ts-ignore/, severity: "warning", message: "@ts-ignore suppresses type errors silently; add an explanation or fix the underlying type issue." },
    { category: "typescript", regex: /console\.log\(/, severity: "suggestion", message: "Remove leftover console.log/debug statements before merging." },
    { category: "python", regex: /except\s*:\s*$/, severity: "blocker", message: "Bare `except:` catches everything including KeyboardInterrupt/SystemExit; catch a specific exception type." },
    { category: "python", regex: /def\s+\w+\([^)]*=\s*\[\]/, severity: "warning", message: "Mutable default argument ([]) is shared across calls; use None and initialize inside the function." },
    { category: "python", regex: /\bprint\(/, severity: "suggestion", message: "Prefer the `logging` module over `print` for production code." },
    { category: "java", regex: /catch\s*\(\s*Exception\s+\w+\s*\)\s*\{\s*\}/, severity: "blocker", message: "Empty catch block swallows the exception; handle or log it, or catch a more specific type." },
    { category: "java", regex: /catch\s*\(\s*(Exception|Throwable)\s+\w+\s*\)/, severity: "warning", message: "Catching generic Exception/Throwable is broad; catch the most specific exception type possible." },
    { category: "yaml", regex: /uses:\s*[^\s]+@(main|master)\b/, severity: "warning", message: "Pin GitHub Actions to a specific version/SHA instead of @main/@master for reproducibility and supply-chain safety." },
    { category: "yaml", regex: /:\s*(yes|no|on|off)\s*$/i, severity: "suggestion", message: "Ambiguous YAML 1.1 boolean-like scalar; quote it if a literal string was intended." },
];
/**
 * Runs simple, deterministic pattern checks against added lines of each changed file,
 * scoped to the rule categories that apply to that file type.
 */
export function analyzeDiff(files) {
    const findings = [];
    const rulesMap = rulesForFiles(files.map((f) => f.path));
    for (const file of files) {
        const categories = [...rulesMap.keys()].filter((cat) => rulesForFiles([file.path]).has(cat));
        for (const { line, content } of file.addedLines) {
            for (const check of PATTERN_CHECKS) {
                if (!categories.includes(check.category))
                    continue;
                if (check.regex.test(content)) {
                    findings.push({
                        path: file.path,
                        line,
                        severity: check.severity,
                        message: check.message,
                        ruleCategory: check.category,
                    });
                }
            }
        }
    }
    return findings;
}
/** Formats the full markdown summary for the review comment / MCP tool response. */
export function formatReviewSummary(bundle) {
    const { meta, dryRunResult, findings, applicableRuleCategories } = bundle;
    const lines = [];
    lines.push(`# Code Review: ${meta.owner}/${meta.repo}#${meta.number} — ${meta.title}`);
    lines.push("");
    lines.push(`**Base:** \`${meta.baseRefName}\`  **Head:** \`${meta.headRefName}\`  **Files changed:** ${meta.files.length}`);
    lines.push("");
    lines.push("## Dry Run");
    lines.push(`Detected stack: **${dryRunResult.stack}**`);
    lines.push("");
    for (const step of dryRunResult.steps) {
        const status = step.skipped ? "⏭️ skipped" : step.ok ? "✅ passed" : "❌ failed";
        lines.push(`- **${step.step}**: ${status}${step.skipped ? "" : ` (${Math.round(step.durationMs / 1000)}s)`}`);
        if (!step.ok && !step.skipped) {
            lines.push("  ```");
            lines.push("  " + step.output.split("\n").slice(-40).join("\n  "));
            lines.push("  ```");
        }
    }
    lines.push("");
    lines.push(`## Findings (rule categories: ${applicableRuleCategories.join(", ") || "none"})`);
    if (findings.length === 0) {
        lines.push("No pattern-based issues found in the diff.");
    }
    else {
        const bySeverity = { blocker: 0, warning: 0, suggestion: 0 };
        for (const f of findings)
            bySeverity[f.severity]++;
        lines.push(`${bySeverity.blocker} blocker(s), ${bySeverity.warning} warning(s), ${bySeverity.suggestion} suggestion(s).`);
        lines.push("");
        for (const f of findings) {
            lines.push(`- **${f.severity.toUpperCase()}** \`${f.path}:${f.line}\` — ${f.message}`);
        }
    }
    lines.push("");
    lines.push("## Coding-Agent Instructions Considered");
    if (bundle.instructions.length === 0) {
        lines.push("No repo instruction files were found (.github/copilot-instructions.md, AGENTS.md, .github/instructions/*.md).");
    }
    else {
        for (const doc of bundle.instructions) {
            lines.push(`- \`${doc.source}\``);
        }
    }
    return lines.join("\n");
}
/** Decides the overall review event based on dry-run results and finding severities. */
export function decideReviewEvent(bundle) {
    const dryRunFailed = bundle.dryRunResult.steps.some((s) => !s.skipped && !s.ok);
    const hasBlocker = bundle.findings.some((f) => f.severity === "blocker");
    if (dryRunFailed || hasBlocker)
        return "REQUEST_CHANGES";
    if (bundle.findings.some((f) => f.severity === "warning"))
        return "COMMENT";
    return "APPROVE";
}
/** Converts findings into GitHub inline review comments. */
export function findingsToReviewComments(findings) {
    return findings.map((f) => ({
        path: f.path,
        line: f.line,
        body: `**${f.severity.toUpperCase()}**: ${f.message}`,
    }));
}
