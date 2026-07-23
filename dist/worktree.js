import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const execFileAsync = promisify(execFile);
async function run(cmd, args, cwd) {
    const { stdout } = await execFileAsync(cmd, args, {
        cwd,
        maxBuffer: 100 * 1024 * 1024,
    });
    return stdout;
}
const CACHE_ROOT = path.join(os.homedir(), ".copilot", "code-reviewer", "cache");
function repoDirName(owner, repo) {
    return `${owner}__${repo}`;
}
/** Ensures a bare-ish local clone of the repo exists and is up to date, returns its path. */
async function ensureBareClone(owner, repo) {
    const dir = path.join(CACHE_ROOT, repoDirName(owner, repo));
    await mkdir(CACHE_ROOT, { recursive: true });
    try {
        await run("git", ["-C", dir, "rev-parse", "--git-dir"]);
        // Already cloned; refresh remote refs.
        await run("git", ["-C", dir, "fetch", "origin", "--prune"]);
    }
    catch {
        await rm(dir, { recursive: true, force: true });
        await run("gh", [
            "repo",
            "clone",
            `${owner}/${repo}`,
            dir,
            "--",
            "--no-checkout",
        ]);
    }
    return dir;
}
/**
 * Checks out a PR into an isolated git worktree so the user's own working copy
 * (if any) is never touched. Handles both same-repo and fork PRs by fetching
 * the `refs/pull/<n>/head` ref directly from the upstream repo.
 */
export async function checkoutPrWorktree(owner, repo, prNumber) {
    const mainRepoPath = await ensureBareClone(owner, repo);
    const localRef = `pr-${prNumber}`;
    await run("git", [
        "-C",
        mainRepoPath,
        "fetch",
        "origin",
        `pull/${prNumber}/head:${localRef}`,
        "--force",
    ]);
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const worktreePath = path.join(CACHE_ROOT, "worktrees", `${repoDirName(owner, repo)}-pr${prNumber}-${runId}`);
    await mkdir(path.dirname(worktreePath), { recursive: true });
    // Prune stale worktree registrations left over from prior (e.g. interrupted) runs.
    await run("git", ["-C", mainRepoPath, "worktree", "prune"]).catch(() => { });
    // Use a run-unique branch name so concurrent/repeated reviews of the same PR
    // never collide on a branch still checked out by another worktree.
    await run("git", [
        "-C",
        mainRepoPath,
        "worktree",
        "add",
        "--force",
        "-B",
        `review-${localRef}-${runId}`,
        worktreePath,
        localRef,
    ]);
    return { worktreePath, mainRepoPath, headRefName: localRef };
}
/** Removes a worktree created by checkoutPrWorktree. Safe to call even if partially created. */
export async function cleanupWorktree(checkout) {
    await run("git", [
        "-C",
        checkout.mainRepoPath,
        "worktree",
        "remove",
        "--force",
        checkout.worktreePath,
    ]).catch(() => { });
    await rm(checkout.worktreePath, { recursive: true, force: true }).catch(() => { });
}
