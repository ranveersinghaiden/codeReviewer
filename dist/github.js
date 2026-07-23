import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
async function run(cmd, args, cwd) {
    const { stdout } = await execFileAsync(cmd, args, {
        cwd,
        maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
}
/** Confirms `gh` CLI exists and is authenticated. Throws a helpful error otherwise. */
export async function ensureGhAvailable() {
    try {
        await run("gh", ["--version"]);
    }
    catch {
        throw new Error("GitHub CLI ('gh') is not installed. Install it from https://cli.github.com/ to use this server.");
    }
    try {
        // `gh auth status` exits non-zero if ANY configured account has an invalid
        // token, even when the active account is fine. Check stderr/stdout for at
        // least one active, logged-in account rather than relying on exit code.
        await run("gh", ["auth", "status"]);
    }
    catch (err) {
        const output = `${err?.stdout ?? ""}${err?.stderr ?? ""}`;
        if (/Logged in to .+ account/.test(output) && /Active account: true/.test(output)) {
            return;
        }
        throw new Error("GitHub CLI ('gh') is not authenticated. Run `gh auth login` first.");
    }
}
/** Fetches PR metadata + file list via `gh pr view`. */
export async function fetchPrMeta(owner, repo, prNumber) {
    const stdout = await run("gh", [
        "pr",
        "view",
        String(prNumber),
        "--repo",
        `${owner}/${repo}`,
        "--json",
        "title,body,baseRefName,headRefName,headRepositoryOwner,isCrossRepository,headRefOid,files,labels",
    ]);
    const json = JSON.parse(stdout);
    return {
        owner,
        repo,
        number: prNumber,
        title: json.title ?? "",
        body: json.body ?? "",
        baseRefName: json.baseRefName,
        headRefName: json.headRefName,
        headRepositoryOwner: json.headRepositoryOwner?.login ?? owner,
        isCrossRepository: !!json.isCrossRepository,
        headRefOid: json.headRefOid ?? "",
        labels: (json.labels ?? []).map((l) => l.name),
        files: (json.files ?? []).map((f) => ({
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
        })),
    };
}
/** Fetches the unified diff of a PR via `gh pr diff`. */
export async function fetchPrDiff(owner, repo, prNumber) {
    return run("gh", [
        "pr",
        "diff",
        String(prNumber),
        "--repo",
        `${owner}/${repo}`,
    ]);
}
/**
 * Fetches ALL prior reviews on a PR (paginated, per review-pr-operations skill
 * guidance) so the calling agent can see existing verdicts (e.g. an unresolved
 * CHANGES_REQUESTED from a human or another reviewer) BEFORE posting a new one —
 * missing this caused a real incident: a duplicate APPROVED review was posted
 * on top of an existing unresolved CHANGES_REQUESTED review that raised a
 * BLOCKER the second reviewer never saw.
 */
export async function fetchPrReviews(owner, repo, prNumber) {
    const stdout = await run("gh", [
        "api",
        `repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
        "--paginate",
    ]);
    // --paginate with a JSON array endpoint concatenates one JSON array per page
    // back-to-back with no separator; parse defensively by scanning top-level arrays.
    const reviews = [];
    let rest = stdout.trim();
    while (rest.length > 0) {
        let depth = 0;
        let end = -1;
        for (let i = 0; i < rest.length; i++) {
            if (rest[i] === "[")
                depth++;
            else if (rest[i] === "]") {
                depth--;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }
        if (end === -1)
            break;
        const chunk = JSON.parse(rest.slice(0, end + 1));
        reviews.push(...chunk);
        rest = rest.slice(end + 1).trim();
    }
    return reviews.map((r) => ({
        author: r.user?.login ?? "unknown",
        state: r.state,
        submittedAt: r.submitted_at ?? "",
        body: r.body ?? "",
    }));
}
/** Fetches all commits on the PR (chronological), used to tell whether prior reviews are stale. */
export async function fetchPrCommits(owner, repo, prNumber) {
    const stdout = await run("gh", [
        "api",
        `repos/${owner}/${repo}/pulls/${prNumber}/commits`,
        "--paginate",
    ]);
    const commits = [];
    let rest = stdout.trim();
    while (rest.length > 0) {
        let depth = 0;
        let end = -1;
        for (let i = 0; i < rest.length; i++) {
            if (rest[i] === "[")
                depth++;
            else if (rest[i] === "]") {
                depth--;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }
        if (end === -1)
            break;
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
