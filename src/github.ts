import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PrMeta {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  baseRefName: string;
  baseRefOid: string;
  headRefName: string;
  headRepositoryOwner: string;
  isCrossRepository: boolean;
  headRefOid: string;
  files: { path: string; additions: number; deletions: number }[];
  labels: string[];
}

export interface PrReview {
  id: number;
  author: string;
  state: string; // APPROVED / CHANGES_REQUESTED / COMMENTED / DISMISSED / PENDING
  submittedAt: string;
  body: string;
}

/** An inline review comment that must be reconciled before a review verdict is issued. */
export interface PrReviewComment {
  id: number;
  reviewId: number | null;
  author: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  body: string;
  createdAt: string;
  commitId: string;
  originalCommitId: string;
  url: string;
  threadId: string | null;
  isThreadResolved: boolean | null;
  isThreadOutdated: boolean | null;
  isReply: boolean | null;
}

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
}

export interface PrCommit {
  sha: string;
  committedDate: string;
  message: string;
}

export interface PrComparison {
  changedPaths: string[];
  diff: string;
}

interface ReviewThreadCommentState {
  commentId: number;
  threadId: string;
  isResolved: boolean;
  isOutdated: boolean;
  isReply: boolean;
}

async function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, {
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  });
  return stdout;
}

/** Confirms `gh` CLI exists and is authenticated. Throws a helpful error otherwise. */
export async function ensureGhAvailable(): Promise<void> {
  try {
    await run("gh", ["--version"]);
  } catch {
    throw new Error(
      "GitHub CLI ('gh') is not installed. Install it from https://cli.github.com/ to use this server."
    );
  }
  try {
    // `gh auth status` exits non-zero if ANY configured account has an invalid
    // token, even when the active account is fine. Check stderr/stdout for at
    // least one active, logged-in account rather than relying on exit code.
    await run("gh", ["auth", "status"]);
  } catch (err: any) {
    const output = `${err?.stdout ?? ""}${err?.stderr ?? ""}`;
    if (/Logged in to .+ account/.test(output) && /Active account: true/.test(output)) {
      return;
    }
    throw new Error(
      "GitHub CLI ('gh') is not authenticated. Run `gh auth login` first."
    );
  }
}

/** Fetches PR metadata + file list via `gh pr view`. */
export async function fetchPrMeta(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PrMeta> {
  const stdout = await run("gh", [
    "pr",
    "view",
    String(prNumber),
    "--repo",
    `${owner}/${repo}`,
    "--json",
    "title,body,baseRefName,baseRefOid,headRefName,headRepositoryOwner,isCrossRepository,headRefOid,files,labels",
  ]);
  const json = JSON.parse(stdout);
  return {
    owner,
    repo,
    number: prNumber,
    title: json.title ?? "",
    body: json.body ?? "",
    baseRefName: json.baseRefName,
    baseRefOid: json.baseRefOid ?? "",
    headRefName: json.headRefName,
    headRepositoryOwner: json.headRepositoryOwner?.login ?? owner,
    isCrossRepository: !!json.isCrossRepository,
    headRefOid: json.headRefOid ?? "",
    labels: (json.labels ?? []).map((l: any) => l.name),
    files: (json.files ?? []).map((f: any) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    })),
  };
}

/** Fetches the unified diff of a PR via `gh pr diff`. */
export async function fetchPrDiff(
  owner: string,
  repo: string,
  prNumber: number
): Promise<string> {
  return run("gh", [
    "pr",
    "diff",
    String(prNumber),
    "--repo",
    `${owner}/${repo}`,
  ]);
}

/**
 * Returns the exact comparison from a previously finalized head to the
 * current head. A null result means the range is incomplete or diverged and
 * must be reviewed base-to-head instead.
 */
export async function fetchPrComparison(
  owner: string,
  repo: string,
  baseSha: string,
  headSha: string
): Promise<PrComparison | null> {
  const endpoint = `repos/${owner}/${repo}/compare/${baseSha}...${headSha}`;
  const comparison = JSON.parse(await run("gh", ["api", endpoint]));
  const files = comparison.files ?? [];
  if (
    !["ahead", "identical"].includes(comparison.status) ||
    comparison.total_commits > 250 ||
    files.length >= 300
  ) {
    return null;
  }
  const diff =
    comparison.status === "identical"
      ? ""
      : await run("gh", ["api", "-H", "Accept: application/vnd.github.v3.diff", endpoint]);
  return { changedPaths: files.map((file: { filename: string }) => file.filename), diff };
}

/**
 * Fetches ALL prior reviews on a PR (paginated, per review-pr-operations skill
 * guidance) so the calling agent can see existing verdicts (e.g. an unresolved
 * CHANGES_REQUESTED from a human or another reviewer) BEFORE posting a new one —
 * missing this caused a real incident: a duplicate APPROVED review was posted
 * on top of an existing unresolved CHANGES_REQUESTED review that raised a
 * BLOCKER the second reviewer never saw.
 */
export async function fetchPrReviews(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PrReview[]> {
  const stdout = await run("gh", [
    "api",
    `repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    "--paginate",
  ]);
  // --paginate with a JSON array endpoint concatenates one JSON array per page
  // back-to-back with no separator; parse defensively by scanning top-level arrays.
  const reviews: any[] = [];
  let rest = stdout.trim();
  while (rest.length > 0) {
    let depth = 0;
    let end = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "[") depth++;
      else if (rest[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    const chunk = JSON.parse(rest.slice(0, end + 1));
    reviews.push(...chunk);
    rest = rest.slice(end + 1).trim();
  }
  return reviews.map((r) => ({
    id: r.id,
    author: r.user?.login ?? "unknown",
    state: r.state,
    submittedAt: r.submitted_at ?? "",
    body: r.body ?? "",
  }));
}

/**
 * GitHub's REST review-comments endpoint does not expose thread resolution or
 * outdated-anchor state. Fetch it through GraphQL so reports can distinguish
 * "source fixed" from "conversation resolved" and identify acknowledgement
 * replies that are not independent findings.
 */
async function fetchReviewThreadCommentStates(
  owner: string,
  repo: string,
  prNumber: number
): Promise<Map<number, ReviewThreadCommentState>> {
  const states = new Map<number, ReviewThreadCommentState>();
  let cursor: string | null = null;

  do {
    const query = `
      query ReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100, after: $after) {
              nodes {
                id
                isResolved
                isOutdated
                comments(first: 100) {
                  nodes {
                    databaseId
                    replyTo { databaseId }
                  }
                  pageInfo { hasNextPage }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    `;
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `repo=${repo}`,
      "-F",
      `number=${prNumber}`,
    ];
    if (cursor !== null) {
      args.push("-f", `after=${cursor}`);
    }

    const json = JSON.parse(await run("gh", args));
    const reviewThreads = json.data?.repository?.pullRequest?.reviewThreads;
    if (!reviewThreads) {
      throw new Error(`GitHub did not return review threads for ${owner}/${repo}#${prNumber}.`);
    }

    for (const thread of reviewThreads.nodes ?? []) {
      if (thread.comments?.pageInfo?.hasNextPage) {
        throw new Error(
          `Review thread ${thread.id} has more than 100 comments; refusing to omit prior feedback.`
        );
      }
      for (const comment of thread.comments?.nodes ?? []) {
        if (typeof comment.databaseId !== "number") {
          continue;
        }
        states.set(comment.databaseId, {
          commentId: comment.databaseId,
          threadId: thread.id,
          isResolved: thread.isResolved,
          isOutdated: thread.isOutdated,
          isReply: comment.replyTo?.databaseId != null,
        });
      }
    }
    cursor = reviewThreads.pageInfo?.hasNextPage ? reviewThreads.pageInfo.endCursor : null;
  } while (cursor !== null);

  return states;
}

/**
 * Fetches every inline review comment, including comments whose parent review
 * has no summary body. Review summaries alone are insufficient evidence that
 * prior feedback was considered.
 */
export async function fetchPrReviewComments(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PrReviewComment[]> {
  const [stdout, threadStates] = await Promise.all([
    run("gh", [
      "api",
      `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
      "--paginate",
    ]),
    fetchReviewThreadCommentStates(owner, repo, prNumber),
  ]);
  const comments: any[] = [];
  let rest = stdout.trim();
  while (rest.length > 0) {
    let depth = 0;
    let end = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "[") depth++;
      else if (rest[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    comments.push(...JSON.parse(rest.slice(0, end + 1)));
    rest = rest.slice(end + 1).trim();
  }
  return comments.map((comment) => {
    const threadState = threadStates.get(comment.id);
    return {
      id: comment.id,
      reviewId: comment.pull_request_review_id ?? null,
      author: comment.user?.login ?? "unknown",
      path: comment.path ?? "",
      line: comment.line ?? comment.original_line ?? null,
      originalLine: comment.original_line ?? null,
      body: comment.body ?? "",
      createdAt: comment.created_at ?? "",
      commitId: comment.commit_id ?? "",
      originalCommitId: comment.original_commit_id ?? "",
      url: comment.html_url ?? "",
      threadId: threadState?.threadId ?? null,
      isThreadResolved: threadState?.isResolved ?? null,
      isThreadOutdated: threadState?.isOutdated ?? null,
      isReply: threadState?.isReply ?? null,
    };
  });
}

/** Fetches all commits on the PR (chronological), used to tell whether prior reviews are stale. */
export async function fetchPrCommits(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PrCommit[]> {
  const stdout = await run("gh", [
    "api",
    `repos/${owner}/${repo}/pulls/${prNumber}/commits`,
    "--paginate",
  ]);
  const commits: any[] = [];
  let rest = stdout.trim();
  while (rest.length > 0) {
    let depth = 0;
    let end = -1;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "[") depth++;
      else if (rest[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    const chunk = JSON.parse(rest.slice(0, end + 1));
    commits.push(...chunk);
    rest = rest.slice(end + 1).trim();
  }
  return commits.map((c) => ({
    sha: c.sha,
    committedDate: c.commit?.committer?.date ?? c.commit?.author?.date ?? "",
    message: (c.commit?.message ?? "").split("\n")[0],
  }));
}

// NOTE: This server is intentionally read-only — it has no function to post
// reviews, comments, or any other write action to GitHub. Fetching PR
// metadata/diff and checking the PR out locally (read-only worktree) are the
// only supported operations, matching the CodeReviewer agent's "Read-only git
// access only" role constraint.
