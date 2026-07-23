#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ensureGhAvailable, fetchPrMeta, fetchPrDiff, fetchPrReviews } from "./github.js";
import { checkoutPrWorktree, cleanupWorktree } from "./worktree.js";
import { loadInstructions, formatInstructionsContext } from "./instructions.js";
import { gatherReviewContext, formatReviewContext } from "./reviewContext.js";
import { buildReviewPayload } from "./reviewPayload.js";
// This MCP server is strictly READ-ONLY: it never runs `git commit`/`git push`/
// `gh pr create`/`gh pr merge`/`gh api ... reviews` or any other write action,
// and it never executes the PR's own code (no install/build/lint/test). It only
// fetches PR metadata/diff/checks the PR out into a disposable local worktree,
// and (via build_review_payload) formats findings into a ready-to-submit
// GitHub review payload — but never submits it. All rule judgement
// (BLOCKER/WARNING/SUGGESTION) and the actual `gh api .../reviews` POST call
// remain the calling agent's responsibility, only after explicit human sign-off.
const server = new McpServer({
    name: "code-reviewer-mcp",
    version: "0.3.0",
});
const prIdentifierShape = {
    owner: z.string().describe("Repository owner, e.g. 'octocat'"),
    repo: z.string().describe("Repository name, e.g. 'hello-world'"),
    pr_number: z.number().int().positive().describe("Pull request number"),
};
server.registerTool("fetch_pr", {
    title: "Fetch PR locally (read-only)",
    description: "Checks out a GitHub pull request into an isolated, disposable local git worktree (read-only — never touches any existing local checkout, never pushes/commits) and returns its metadata (title, body, base/head refs, changed files).",
    inputSchema: prIdentifierShape,
}, async ({ owner, repo, pr_number }) => {
    await ensureGhAvailable();
    const meta = await fetchPrMeta(owner, repo, pr_number);
    const checkout = await checkoutPrWorktree(owner, repo, pr_number);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ meta, worktreePath: checkout.worktreePath }, null, 2),
            },
        ],
    };
});
server.registerTool("load_instructions", {
    title: "Load coding-agent instructions",
    description: "Reads .github/copilot-instructions.md, .github/instructions/*.md, and AGENTS.md from a PR's checked-out repo (read-only) to gather review context.",
    inputSchema: prIdentifierShape,
}, async ({ owner, repo, pr_number }) => {
    await ensureGhAvailable();
    const checkout = await checkoutPrWorktree(owner, repo, pr_number);
    try {
        const docs = await loadInstructions(checkout.worktreePath);
        return { content: [{ type: "text", text: formatInstructionsContext(docs) }] };
    }
    finally {
        await cleanupWorktree(checkout);
    }
});
server.registerTool("gather_review_context", {
    title: "Gather deep review context for a PR (read-only)",
    description: "The core tool for in-depth PR review. Checks out the PR read-only, then returns: any PRIOR REVIEWS already posted on this PR (author, verdict, body — ALWAYS check this before posting a new review; never post a duplicate/conflicting APPROVE over an unresolved CHANGES_REQUESTED), an explicit verification-evidence checklist if the PR is labeled AI_AUTOFIX/AI_AUTOFIX_NEEDS_REVIEW (this repo's autofix pipeline requires a live passing test re-run as evidence, not just a clean diff), the PR diff, the FULL current content of every changed file (not just the diff hunk, so the reviewer can judge changes in relation to the surrounding class/module rather than in isolation), the module(s) each changed file belongs to, any out-of-scope/scope-creep files detected, any framework/protected files touched (pom.xml, Hooks.java, PropertyReader.java, Constants.java, EnvGuard.java, runner classes, CI workflow YAML — these require explicit human approval before merge), and the matching review skill files (.github/skills/*/SKILL.md) plus repo instruction docs (.github/instructions/*.instructions.md) for the modules touched, and a MANDATORY cross-reference checklist (file-move/rename path-arithmetic recomputation, moved-file non-code dependency drift, stale references to old paths, doc-vs-actual-script behavior mismatches, untrusted GitHub Actions input reaching a shell, CLI-arg regex leading-dash injection, a dry-run-discipline reminder, CI workflow step-ordering — tool invocations must come after their own setup/toolchain step, checked independently per job — and protected/framework-file portability/process checks), plus a MANDATORY test-automation framework layering checklist for Playwright/Appium projects (WebAction/MobileAction must contain only low-level driver/screen actions with no business logic or embedded validations; Playwright must be initialized exactly once in hooks, not re-initialized elsewhere; validations belong in page/screen objects; step definitions should ideally be thin bindings only; locators should prefer id/class-name/stable-attribute strategies over fragile CSS/XPath/text/positional selectors). This tool does NOT run tests/builds and does NOT post anything to GitHub — it only gathers context. The calling agent is responsible for applying the rules from the returned skills/instructions and producing the final BLOCKER/WARNING/SUGGESTION report.",
    inputSchema: prIdentifierShape,
}, async ({ owner, repo, pr_number }) => {
    await ensureGhAvailable();
    const meta = await fetchPrMeta(owner, repo, pr_number);
    const checkout = await checkoutPrWorktree(owner, repo, pr_number);
    try {
        const diff = await fetchPrDiff(owner, repo, pr_number);
        const priorReviews = await fetchPrReviews(owner, repo, pr_number);
        const ctx = await gatherReviewContext(checkout.worktreePath, meta, diff, priorReviews);
        return { content: [{ type: "text", text: formatReviewContext(ctx) }] };
    }
    finally {
        await cleanupWorktree(checkout);
    }
});
const findingShape = z.object({
    severity: z.enum(["BLOCKER", "WARNING", "SUGGESTION"]),
    file: z.string().describe("Path of the file the finding applies to, relative to repo root, matching the PR diff (e.g. 'src/foo.py')."),
    line: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Line number in the NEW version of the file. Omit for whole-file/cross-cutting findings — they'll be folded into the review body instead of an inline comment."),
    message: z.string().describe("The finding description and concrete fix, in the reviewer's own words."),
    suggestion: z
        .string()
        .optional()
        .describe("Optional exact replacement text for a one-line fix, rendered as a GitHub ```suggestion``` block the PR author can accept with one click."),
});
server.registerTool("build_review_payload", {
    title: "Build a GitHub inline-review payload from findings (does NOT post)",
    description: "Given a structured list of findings (severity/file/line/message/suggestion) plus a summary body and verdict, fetches the PR's current diff and HEAD commit, and returns a ready-to-submit `gh api repos/<owner>/<repo>/pulls/<n>/reviews -X POST` JSON payload with one inline review comment per finding attached to its exact file:line (side: RIGHT), per the review-pr-operations skill's mechanics. Findings with no line, or whose line isn't part of the diff (would 422), are automatically folded into the summary body instead of being dropped, and listed separately in the response so the calling agent can tell the user. This tool NEVER calls the GitHub API itself — it only returns the payload JSON. The calling agent must show it to the user, get explicit confirmation, then post it themselves, e.g.: `gh api repos/<owner>/<repo>/pulls/<n>/reviews -X POST --input payload.json`.",
    inputSchema: {
        ...prIdentifierShape,
        findings: z.array(findingShape).describe("The findings to attach as inline comments."),
        summary_body: z.string().describe("The markdown summary body (## Code Review Report header, BLOCKERS/WARNINGS/SUGGESTIONS section headers, Summary + verdict line) to post alongside the inline comments."),
        verdict: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).describe("The review event to submit: APPROVE (0 blockers), REQUEST_CHANGES (>=1 blocker), or COMMENT (open question, no verdict yet)."),
    },
}, async ({ owner, repo, pr_number, findings, summary_body, verdict }) => {
    await ensureGhAvailable();
    const meta = await fetchPrMeta(owner, repo, pr_number);
    const diff = await fetchPrDiff(owner, repo, pr_number);
    const result = buildReviewPayload(findings, summary_body, verdict, meta.headRefOid, diff);
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    payload: result.payload,
                    foldedIntoBody: result.foldedIntoBody,
                    postCommand: `gh api repos/${owner}/${repo}/pulls/${pr_number}/reviews -X POST --input <payload-file>`,
                }, null, 2),
            },
        ],
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error("Fatal error starting code-reviewer-mcp:", err);
    process.exit(1);
});
