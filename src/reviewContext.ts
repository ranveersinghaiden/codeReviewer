import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrMeta, PrReview, PrCommit } from "./github.js";
import { classifyChangedFiles, detectOutOfScopeFiles, type FileClassification } from "./scope.js";

export interface FileContext {
  path: string;
  classification: FileClassification;
  fullContent: string | null; // null if binary/unreadable/too large
  truncated: boolean;
}

export interface SkillDoc {
  path: string;
  content: string | null;
}

export interface ReviewContext {
  meta: PrMeta;
  diff: string;
  changedFiles: FileContext[];
  outOfScopeFiles: string[];
  skills: SkillDoc[];
  repoInstructions: SkillDoc[];
  priorReviews: PrReview[];
  isAutofixPr: boolean;
  commitsSincePriorReviews: PrCommit[];
}

const MAX_FILE_CHARS = 60_000;

async function readFileSafe(fullPath: string): Promise<{ content: string | null; truncated: boolean }> {
  try {
    const buf = await readFile(fullPath);
    // crude binary sniff
    if (buf.subarray(0, 8000).includes(0)) {
      return { content: null, truncated: false };
    }
    const text = buf.toString("utf8");
    if (text.length > MAX_FILE_CHARS) {
      return { content: text.slice(0, MAX_FILE_CHARS) + "\n...(truncated)...", truncated: true };
    }
    return { content: text, truncated: false };
  } catch {
    return { content: null, truncated: false };
  }
}

/**
 * Builds the full context bundle a reviewer needs: PR diff + metadata, the FULL
 * content of every changed file (not just the diff hunk, so class/method-level
 * context is visible), matched review skill files + instruction docs per module,
 * and any out-of-scope / framework-file flags. Performs no execution and posts
 * nothing — purely read/gather.
 */
export async function gatherReviewContext(
  worktreePath: string,
  meta: PrMeta,
  diff: string,
  priorReviews: PrReview[] = [],
  commits: PrCommit[] = []
): Promise<ReviewContext> {
  const changedPaths = meta.files.map((f) => f.path);
  const classifications = classifyChangedFiles(changedPaths);
  const outOfScopeFiles = detectOutOfScopeFiles(classifications);
  const isAutofixPr = meta.labels.some((l) => /^AI_AUTOFIX/i.test(l));

  const changedFiles: FileContext[] = await Promise.all(
    classifications.map(async (classification) => {
      const { content, truncated } = await readFileSafe(path.join(worktreePath, classification.path));
      return { path: classification.path, classification, fullContent: content, truncated };
    })
  );

  const skillPathsNeeded = new Set<string>();
  const instructionPathsNeeded = new Set<string>();
  for (const c of classifications) {
    c.skillPaths.forEach((s) => skillPathsNeeded.add(s));
    c.instructionPaths.forEach((s) => instructionPathsNeeded.add(s));
  }

  const [skills, repoInstructions] = await Promise.all([
    Promise.all(
      [...skillPathsNeeded].map(async (p) => ({
        path: p,
        content: (await readFileSafe(path.join(worktreePath, p))).content,
      }))
    ),
    Promise.all(
      [...instructionPathsNeeded].map(async (p) => ({
        path: p,
        content: (await readFileSafe(path.join(worktreePath, p))).content,
      }))
    ),
  ]);

  // Determine, per prior review, whether any commit landed AFTER it was submitted —
  // that tells the reviewer whether the PR has changed since that review and thus
  // whether the review's findings might already be stale/addressed (or not yet reviewed at all).
  const latestReviewTime = priorReviews.length
    ? Math.max(...priorReviews.map((r) => (r.submittedAt ? Date.parse(r.submittedAt) : 0)))
    : 0;
  const commitsSincePriorReviews = commits.filter(
    (c) => c.committedDate && Date.parse(c.committedDate) > latestReviewTime
  );

  return {
    meta,
    diff,
    changedFiles,
    outOfScopeFiles,
    skills,
    repoInstructions,
    priorReviews,
    isAutofixPr,
    commitsSincePriorReviews,
  };
}

/** Serializes the review context into a single markdown/text bundle for an LLM reviewer to consume. */
export function formatReviewContext(ctx: ReviewContext): string {
  const parts: string[] = [];
  parts.push(`# Review Context: ${ctx.meta.owner}/${ctx.meta.repo}#${ctx.meta.number} — ${ctx.meta.title}`);
  parts.push(`Base: \`${ctx.meta.baseRefName}\`  Head: \`${ctx.meta.headRefName}\``);
  parts.push("");
  if (ctx.meta.body) {
    parts.push("## PR Description");
    parts.push(ctx.meta.body);
    parts.push("");
  }

  if (ctx.priorReviews.length > 0) {
    const unresolved = ctx.priorReviews.filter((r) => r.state === "CHANGES_REQUESTED");
    parts.push("## ⚠️ PRIOR REVIEWS ON THIS PR — CHECK BEFORE POSTING A NEW REVIEW");
    parts.push(
      "Do NOT post a new review (especially APPROVE) without accounting for these. If any are CHANGES_REQUESTED and the blocking issue hasn't visibly been fixed since, your new review must address it explicitly — either confirm it's resolved (and say how you verified that) or don't approve."
    );
    if (unresolved.length > 0) {
      parts.push(`**${unresolved.length} unresolved CHANGES_REQUESTED review(s) found:**`);
    }
    if (ctx.commitsSincePriorReviews.length > 0) {
      parts.push(
        `**${ctx.commitsSincePriorReviews.length} commit(s) landed AFTER the most recent prior review** — the PR has changed since it was last reviewed:`
      );
      for (const c of ctx.commitsSincePriorReviews) {
        parts.push(`- \`${c.sha.slice(0, 7)}\` (${c.committedDate}) — ${c.message}`);
      }
      parts.push(
        "Re-review the diff against these new commits specifically: confirm each prior finding this PR " +
          "claims to address is actually fixed by one of the commits above (don't take the claim at face value), " +
          "and check whether these new commits introduce any NEW issues of their own that a prior review " +
          "wouldn't have seen."
      );
    } else {
      parts.push(
        "**No commits have landed since the most recent prior review** — this PR's code is unchanged since " +
          "it was last reviewed. Any prior review comment still visible on GitHub (not superseded by a later " +
          "commit) should be treated as still live/unresolved, not stale — do not assume it was silently fixed."
      );
    }
    for (const r of ctx.priorReviews) {
      parts.push(`### ${r.author} — ${r.state} (${r.submittedAt})`);
      parts.push(r.body || "(no body)");
      parts.push("");
    }
  } else {
    parts.push("## Prior Reviews");
    parts.push("(none found — this is the first review on this PR)");
    parts.push("");
  }

  if (ctx.isAutofixPr) {
    parts.push("## 🤖 AI_AUTOFIX PR — Additional Verification-Evidence Requirement");
    parts.push(
      "This PR is labeled AI_AUTOFIX / AI_AUTOFIX_NEEDS_REVIEW. Per this repo's established review practice " +
        "(seen in prior human reviews, not yet written into a skill file — treat as binding anyway): " +
        "static analysis, compile checks, and locator/config correctness review are NOT sufficient evidence " +
        "that an autofix actually fixes the originally-failing scenario. Before approving an AI_AUTOFIX PR that " +
        "claims to have fixed a test, verify (or explicitly flag as an open BLOCKER if not verifiable by you):\n" +
        "- Has a live, targeted Cucumber/test re-run of the specific affected scenario(s) been executed on this PR's " +
        "head branch (not just main), with a passing result attached (run URL / summary)?\n" +
        "- If no such run exists or is linked, this is a BLOCKER — request the PR author/pipeline dispatch the " +
        "relevant manual test workflow against this branch and attach the passing run before approving, " +
        "regardless of how clean the diff itself looks."
    );
    parts.push("");
  }

  parts.push("## 🔗 Cross-Reference Check (MANDATORY — cross-file/cross-artifact consistency)");
  parts.push(
    "Most within-file rules catch issues in isolation. These catch issues that only show up when a changed " +
      "file is compared against another file, path, or its own runtime behavior — a class of bug that slips " +
      "through file-by-file reading. Apply all that are relevant to this diff:\n" +
      "\n" +
      "**File Moves & Renames**\n" +
      "- BLOCKER: any file move/rename where a `Path(__file__).resolve().parents[N])` (or equivalent relative-path " +
      "arithmetic in any language) literal was not recomputed for the file's new depth from repo root. Don't just " +
      "read the literal — actually resolve it (e.g. `python3 -c \"from pathlib import Path; print(Path('<file>').resolve().parents[N])\"`) " +
      "and confirm the result is the expected directory.\n" +
      "- BLOCKER: a moved file's non-code dependencies (fixtures, data files, config, .json/.csv test assets) were " +
      "left at the old path instead of moving with it. Grep the moved file for relative-path references and confirm " +
      "each resolves to an existing path post-move.\n" +
      "- WARNING: a file is moved/renamed but another file still imports it or references its old path (via " +
      "sys.path tweaks, conftest.py, doc examples, workflow run: steps) — grep the whole repo for the old " +
      "path/module name, not just the diff, before approving.\n" +
      "\n" +
      "**Docs vs. Actual Code/Script Behavior**\n" +
      "- WARNING: a shell/script usage example in a doc sets an env var or flag that the actual script doesn't " +
      "read (or reads under a different name) — cross-check the doc's example against the script's real " +
      "env-var/arg names.\n" +
      "- WARNING: a skill/instruction doc references a file or directory path (as an \"applies to\" glob, example, " +
      "or migration note) that doesn't exist in the repo — verify with ls/find before approving a doc diff.\n" +
      "\n" +
      "**Untrusted Input Reaching a Shell**\n" +
      "- BLOCKER: `${{ github.event.inputs.* }}` / `github.event.*.body` / other user- or PR-controlled GitHub " +
      "Actions context interpolated directly into a run: shell body instead of via env: + \"$VAR\" — even if the " +
      "workflow trigger itself requires write access, treat this as insider-risk script injection and require " +
      "the env: pattern.\n" +
      "- WARNING: a CLI-input validation regex (e.g. validating a git ref, branch name, or scenario filter) " +
      "accepts a value starting with -/-- , which downstream tools (git, mvn, curl) may parse as an option " +
      "rather than literal data — require the regex to reject a leading dash.\n" +
      "\n" +
      "**Dry-Run Discipline (reinforces existing mandate)**\n" +
      "- BLOCKER: a new/modified test's assertions were read but not actually executed before approving. " +
      "Regex/formatting bugs and stale path arithmetic are frequently only caught by running the code — do not " +
      "approve on read-through alone when a runnable test suite exists.\n" +
      "\n" +
      "**Workflow Step Ordering (CI/CD YAML)**\n" +
      "- WARNING/BLOCKER: a new or moved step invokes a tool (python3, node, a specific compiler/SDK version) " +
      "that the job only guarantees via an earlier setup step (actions/setup-python, setup-node, setup-java, " +
      "etc.) — but the new step was placed BEFORE that setup step in the same job. Read the full job's step " +
      "list top-to-bottom (not just the diff hunk) and confirm every tool invocation comes after its own " +
      "setup/toolchain-pinning step; runner-preinstalled defaults can silently drift and this class of bug does " +
      "not show up from reading the diff hunk alone.\n" +
      "- Applies equally when a step is moved/reordered/duplicated across multiple jobs in the same file — check " +
      "each job's ordering independently, a fix in one job does not guarantee the same fix in a sibling job.\n" +
      "\n" +
      "**Protected/Framework File Changes — Portability & Process**\n" +
      "- WARNING: a build-file change (pom.xml, package.json, build.gradle, etc.) wires in a new build-lifecycle " +
      "step that shells out to a platform-specific interpreter (bash, sh, a POSIX-only script) without a documented " +
      "or enforced skip/opt-out for platforms where that interpreter isn't guaranteed (e.g. native Windows dev " +
      "machines without WSL/git-bash) — confirm a skip flag exists AND is actually documented/discoverable, not " +
      "just present in a code comment.\n" +
      "- Re-confirm: any BLOCKER-level protected-file-change-requires-explicit-approval rule from this repo's own " +
      "instructions applies to every individual framework file changed, not just a representative sample — " +
      "explicitly enumerate each one in the report rather than summarizing as a group."
  );
  parts.push("");

  parts.push("## 🏗️ Test Automation Framework Layering (apply where relevant for Playwright/Appium projects)");
  parts.push(
    "This repo prefers a clear separation of concerns across the automation layers. These are judgment calls, " +
      "not blanket blockers — apply whichever are relevant to the frameworks touched by this diff, and weigh " +
      "severity based on how far the new code strays from the existing pattern in that class:\n" +
      "\n" +
      "**Playwright — `WebAction` (or equivalently-named low-level action class)**\n" +
      "- WARNING (SUGGESTION if minor/borderline): `WebAction` (and equivalent low-level driver-wrapper classes) " +
      "should contain only raw Playwright/browser actions (click, type, hover, wait, navigate, evaluate, locator " +
      "helpers, etc.) — not business logic (e.g. computing expected values, branching on domain-specific state) " +
      "or validations/assertions. If a new/modified `WebAction` method embeds an assertion (assertThat, Assert.*, " +
      "throwing on a business condition) or domain-specific conditional logic, flag it — that logic belongs in a " +
      "page object or step definition instead.\n" +
      "- Before flagging any brand-new method added to `WebAction`/`MobileAction` (or a page/screen object), first " +
      "check whether it duplicates existing behavior: search the class (and sibling classes) for a method that " +
      "already does the same or near-same action, differing only in a literal (a selector, a wait time, a string " +
      "argument, a boolean flag). If an existing method could achieve the same result by adding/adjusting a " +
      "parameter, prefer a SUGGESTION to parameterize and reuse the existing method over introducing a new one — " +
      "don't treat this as an automatic BLOCKER, just call out the duplication/parameterization opportunity with " +
      "the specific existing method it overlaps with.\n" +
      "- BLOCKER: Playwright (`Playwright.create()`/browser/context launch) must be initialized exactly once, in " +
      "hooks (e.g. `Hooks.java`/`@Before`/`@BeforeAll` or equivalent global setup), not re-initialized inside page " +
      "objects, step definitions, or per-scenario helper code. Grep for additional `Playwright.create()` / " +
      "`.launch(`/browser-context-creation call sites outside the hooks file when a diff touches Playwright " +
      "bootstrap code, and flag any duplicate initialization path.\n" +
      "\n" +
      "**Appium — `MobileAction` (or equivalently-named low-level action class)**\n" +
      "- WARNING (SUGGESTION if minor/borderline): `MobileAction` should contain only raw Appium/mobile-driver or " +
      "screen actions (tap, swipe, scroll, wait, find element, etc.) — not business logic or validations/" +
      "assertions embedded directly in the action method. Same standard as `WebAction` above, applied to the " +
      "mobile stack, including the same duplicate/parameterization check before flagging a new method as a " +
      "layering violation.\n" +
      "\n" +
      "**Validations Placement**\n" +
      "- SUGGESTION/WARNING: validations/assertions are preferred in page objects or screen objects (not in the " +
      "low-level action class, and not buried inline in step definitions). If a new assertion is added directly " +
      "in `WebAction`/`MobileAction` or inline in a step definition instead of a page/screen object method, flag " +
      "it as misplaced.\n" +
      "\n" +
      "**Step Definitions**\n" +
      "- SUGGESTION/WARNING: step definition classes should ideally contain only bindings (Gherkin step string → " +
      "page/screen object method call), not business logic, validations, or direct low-level action calls. A step " +
      "definition method with more than a thin call-through to a page/screen object (e.g. inline conditionals, " +
      "direct `WebAction`/`MobileAction` calls, inline assertions) is a candidate for refactor — flag as SUGGESTION " +
      "unless the complexity is trivial.\n" +
      "\n" +
      "**Locator Strategy**\n" +
      "- SUGGESTION: locators should preferably target `id`, `class name`, or another stable attribute name rather " +
      "than fragile strategies (long/brittle CSS or XPath chains, text-based locators prone to i18n/copy changes, " +
      "positional/index-based selectors). If a new locator in this diff uses a fragile strategy where an id/class/" +
      "attribute-based alternative is plausible, flag it — unless the file's own comments already acknowledge the " +
      "limitation (e.g. \"no stable id found, prefer one if it appears later\"), in which case treat it as already " +
      "self-documented and only a minor note."
  );
  parts.push("");

  if (ctx.outOfScopeFiles.length > 0) {
    parts.push("## ⚠️ Potential Scope Creep Detected");
    parts.push(
      "The following changed files don't share the dominant module of this diff — verify they're intentionally in scope:"
    );
    for (const f of ctx.outOfScopeFiles) parts.push(`- ${f}`);
    parts.push("");
  }

  const frameworkFiles = ctx.changedFiles.filter((f) => f.classification.isFrameworkFile);
  if (frameworkFiles.length > 0) {
    parts.push("## 🛑 Framework/Protected Files Modified (require explicit user approval)");
    for (const f of frameworkFiles) parts.push(`- ${f.path}`);
    parts.push("");
  }

  parts.push("## Unified Diff");
  parts.push("```diff");
  parts.push(ctx.diff);
  parts.push("```");
  parts.push("");

  parts.push("## Full Content of Changed Files (for surrounding-context analysis)");
  for (const f of ctx.changedFiles) {
    parts.push(`### ${f.path}${f.truncated ? " (truncated)" : ""}`);
    if (f.fullContent === null) {
      parts.push("(binary or unreadable — skipped)");
    } else {
      const ext = f.path.split(".").pop() ?? "";
      parts.push("```" + ext);
      parts.push(f.fullContent);
      parts.push("```");
    }
    parts.push("");
  }

  parts.push("## Applicable Review Skills (matched by module/file type)");
  if (ctx.skills.length === 0) {
    parts.push("(none matched)");
  } else {
    for (const s of ctx.skills) {
      parts.push(`### ${s.path}`);
      parts.push(s.content ?? "(not found in repo)");
      parts.push("");
    }
  }

  parts.push("## Applicable Repo Instructions (module-specific context)");
  if (ctx.repoInstructions.length === 0) {
    parts.push("(none matched)");
  } else {
    for (const s of ctx.repoInstructions) {
      parts.push(`### ${s.path}`);
      parts.push(s.content ?? "(not found in repo)");
      parts.push("");
    }
  }

  return parts.join("\n");
}
