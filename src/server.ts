#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  ensureGhAvailable,
  fetchPrMeta,
  fetchPrDiff,
  fetchPrReviews,
  fetchPrReviewComments,
  fetchPrCommits,
} from "./review/collectors/github.js";
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
// remain the calling agent's responsibility, only after explicit user confirmation.

const server = new McpServer({
  name: "code-reviewer-mcp",
  version: "0.3.0",
});

const prIdentifierShape = {
  owner: z.string().describe("Repository owner, e.g. 'octocat'"),
  repo: z.string().describe("Repository name, e.g. 'hello-world'"),
  pr_number: z.number().int().positive().describe("Pull request number"),
};

const gatherReviewContextDescription =
  "Collects a read-only PR review bundle: prior reviews and inline feedback, commits, metadata, diff, full changed-file content, matching instructions, and scope/framework-file flags. It includes review evidence and applicable static-review guidance. The tool never executes PR code or posts to GitHub; the calling reviewer applies the agent contract and presents the final report.";

server.registerTool(
  "fetch_pr",
  {
    title: "Fetch PR locally (read-only)",
    description:
      "Checks out a GitHub pull request into an isolated, disposable local git worktree (read-only — never touches any existing local checkout, never pushes/commits) and returns its metadata (title, body, base/head refs, changed files).",
    inputSchema: prIdentifierShape,
  },
  async ({ owner, repo, pr_number }) => {
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
  }
);

server.registerTool(
  "load_instructions",
  {
    title: "Load coding-agent instructions",
    description:
      "Reads .github/copilot-instructions.md, .github/instructions/*.md, and AGENTS.md from a PR's checked-out repo (read-only) to gather review context.",
    inputSchema: prIdentifierShape,
  },
  async ({ owner, repo, pr_number }) => {
    await ensureGhAvailable();
    const checkout = await checkoutPrWorktree(owner, repo, pr_number);
    try {
      const docs = await loadInstructions(checkout.worktreePath);
      return { content: [{ type: "text", text: formatInstructionsContext(docs) }] };
    } finally {
      await cleanupWorktree(checkout);
    }
  }
);

server.registerTool(
  "gather_review_context",
  {
    title: "Gather deep review context for a PR (read-only)",
    description: gatherReviewContextDescription,
    inputSchema: prIdentifierShape,
  },
  async ({ owner, repo, pr_number }) => {
    await ensureGhAvailable();
    const meta = await fetchPrMeta(owner, repo, pr_number);
    const checkout = await checkoutPrWorktree(owner, repo, pr_number);
    try {
      const diff = await fetchPrDiff(owner, repo, pr_number);
      const priorReviews = await fetchPrReviews(owner, repo, pr_number);
      const [priorReviewComments, commits] = await Promise.all([
        fetchPrReviewComments(owner, repo, pr_number),
        fetchPrCommits(owner, repo, pr_number),
      ]);
      const ctx = await gatherReviewContext(
        checkout.worktreePath,
        meta,
        diff,
        priorReviews,
        priorReviewComments,
        commits
      );
      return { content: [{ type: "text", text: formatReviewContext(ctx) }] };
    } finally {
      await cleanupWorktree(checkout);
    }
  }
);

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

server.registerTool(
  "build_review_payload",
  {
    title: "Build a GitHub inline-review payload from findings (does NOT post)",
    description:
      "Given a structured list of findings (severity/file/line/message/suggestion) plus a summary body and verdict, fetches the PR's current diff and HEAD commit, and returns a ready-to-submit `gh api repos/<owner>/<repo>/pulls/<n>/reviews -X POST` JSON payload with one inline review comment per finding attached to its exact file:line (side: RIGHT), per the review-pr-operations skill's mechanics. Findings with no line, or whose line isn't part of the diff (would 422), are automatically folded into the summary body instead of being dropped, and listed separately in the response so the calling agent can tell the user. This tool NEVER calls the GitHub API itself — it only returns the payload JSON. The calling agent must show it to the user, get explicit confirmation, then post it themselves, e.g.: `gh api repos/<owner>/<repo>/pulls/<n>/reviews -X POST --input payload.json`.",
    inputSchema: {
      ...prIdentifierShape,
      findings: z.array(findingShape).describe("The findings to attach as inline comments."),
      summary_body: z.string().describe("The markdown summary body (## Code Review Report header, BLOCKERS/WARNINGS/SUGGESTIONS section headers, Summary + verdict line) to post alongside the inline comments."),
      verdict: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).describe("The review event to submit: APPROVE (0 blockers), REQUEST_CHANGES (>=1 blocker), or COMMENT (open question, no verdict yet)."),
    },
  },
  async ({ owner, repo, pr_number, findings, summary_body, verdict }) => {
    await ensureGhAvailable();
    const meta = await fetchPrMeta(owner, repo, pr_number);
    const diff = await fetchPrDiff(owner, repo, pr_number);
    const result = buildReviewPayload(findings, summary_body, verdict, meta.headRefOid, diff);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              payload: result.payload,
              foldedIntoBody: result.foldedIntoBody,
              postCommand: `gh api repos/${owner}/${repo}/pulls/${pr_number}/reviews -X POST --input <payload-file>`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting code-reviewer-mcp:", err);
  process.exit(1);
});
