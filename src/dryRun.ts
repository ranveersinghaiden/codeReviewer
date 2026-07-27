import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";

export interface StepResult {
  step: string;
  command: string;
  ok: boolean;
  skipped: boolean;
  durationMs: number;
  output: string; // trimmed tail of combined stdout/stderr
}

export interface DryRunResult {
  stack: string;
  steps: StepResult[];
}

const MAX_OUTPUT_CHARS = 6000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function tail(s: string, max = MAX_OUTPUT_CHARS): string {
  return s.length > max ? `...(truncated)...\n${s.slice(-max)}` : s;
}

async function runStep(
  step: string,
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<StepResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (d) => (output += d.toString()));
    child.stderr?.on("data", (d) => (output += d.toString()));

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        step,
        command: `${cmd} ${args.join(" ")}`.trim(),
        ok: !timedOut && code === 0,
        skipped: false,
        durationMs: Date.now() - start,
        output: tail(timedOut ? output + "\n[timed out]" : output),
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        step,
        command: `${cmd} ${args.join(" ")}`.trim(),
        ok: false,
        skipped: false,
        durationMs: Date.now() - start,
        output: tail(String(err)),
      });
    });
  });
}

function skipped(step: string, reason: string): StepResult {
  return { step, command: reason, ok: true, skipped: true, durationMs: 0, output: reason };
}

/**
 * Detects the project stack in `repoPath` and runs install -> build -> lint -> test,
 * skipping steps that don't apply. Supports Node/TS, Python, and Java (Maven/Gradle).
 */
export async function dryRun(repoPath: string): Promise<DryRunResult> {
  if (await exists(path.join(repoPath, "package.json"))) {
    return runNodeStack(repoPath);
  }
  if (
    (await exists(path.join(repoPath, "pyproject.toml"))) ||
    (await exists(path.join(repoPath, "requirements.txt"))) ||
    (await exists(path.join(repoPath, "setup.py")))
  ) {
    return runPythonStack(repoPath);
  }
  if (await exists(path.join(repoPath, "pom.xml"))) {
    return runMavenStack(repoPath);
  }
  if (
    (await exists(path.join(repoPath, "build.gradle"))) ||
    (await exists(path.join(repoPath, "build.gradle.kts")))
  ) {
    return runGradleStack(repoPath);
  }
  return {
    stack: "unknown",
    steps: [skipped("detect", "No recognized project manifest found (package.json/pyproject.toml/pom.xml/build.gradle); dry run skipped.")],
  };
}

async function runNodeStack(repoPath: string): Promise<DryRunResult> {
  const steps: StepResult[] = [];
  const pkgLock = await exists(path.join(repoPath, "package-lock.json"));
  const yarnLock = await exists(path.join(repoPath, "yarn.lock"));
  const pnpmLock = await exists(path.join(repoPath, "pnpm-lock.yaml"));

  const installCmd = pnpmLock
    ? ["pnpm", ["install", "--frozen-lockfile"]]
    : yarnLock
      ? ["yarn", ["install", "--frozen-lockfile"]]
      : pkgLock
        ? ["npm", ["ci"]]
        : ["npm", ["install"]];
  steps.push(await runStep("install", installCmd[0] as string, installCmd[1] as string[], repoPath, 8 * 60 * 1000));

  const pkgJson = JSON.parse(await (await import("node:fs/promises")).readFile(path.join(repoPath, "package.json"), "utf8"));
  const scripts = pkgJson.scripts ?? {};

  if (scripts.build) {
    steps.push(await runStep("build", "npm", ["run", "build"], repoPath));
  } else {
    steps.push(skipped("build", "No 'build' script in package.json; skipped."));
  }

  if (scripts.lint) {
    steps.push(await runStep("lint", "npm", ["run", "lint"], repoPath));
  } else {
    steps.push(skipped("lint", "No 'lint' script in package.json; skipped."));
  }

  if (scripts.test) {
    steps.push(await runStep("test", "npm", ["test", "--", "--ci"], repoPath));
  } else {
    steps.push(skipped("test", "No 'test' script in package.json; skipped."));
  }

  return { stack: "node", steps };
}

async function runPythonStack(repoPath: string): Promise<DryRunResult> {
  const steps: StepResult[] = [];
  const hasReq = await exists(path.join(repoPath, "requirements.txt"));
  const hasPyproject = await exists(path.join(repoPath, "pyproject.toml"));

  if (hasReq) {
    steps.push(await runStep("install", "pip", ["install", "-r", "requirements.txt"], repoPath, 8 * 60 * 1000));
  } else if (hasPyproject) {
    steps.push(await runStep("install", "pip", ["install", "-e", "."], repoPath, 8 * 60 * 1000));
  } else {
    steps.push(skipped("install", "No requirements.txt/pyproject.toml install target found; skipped."));
  }

  steps.push(skipped("build", "Python projects typically have no separate build step; skipped."));

  if (await hasTool(repoPath, "ruff")) {
    steps.push(await runStep("lint", "ruff", ["check", "."], repoPath));
  } else if (await hasTool(repoPath, "flake8")) {
    steps.push(await runStep("lint", "flake8", ["."], repoPath));
  } else {
    steps.push(skipped("lint", "Neither ruff nor flake8 available; skipped."));
  }

  if (await hasTool(repoPath, "pytest")) {
    steps.push(await runStep("test", "pytest", ["-q"], repoPath));
  } else {
    steps.push(skipped("test", "pytest not available; skipped."));
  }

  return { stack: "python", steps };
}

async function hasTool(cwd: string, tool: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(tool, ["--version"], { cwd, shell: false });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function runMavenStack(repoPath: string): Promise<DryRunResult> {
  const steps: StepResult[] = [];
  const mvnw = (await exists(path.join(repoPath, "mvnw"))) ? "./mvnw" : "mvn";
  steps.push(await runStep("install", mvnw, ["-q", "dependency:go-offline"], repoPath, 8 * 60 * 1000));
  steps.push(await runStep("build", mvnw, ["-q", "compile"], repoPath, 8 * 60 * 1000));
  steps.push(skipped("lint", "No standard Maven lint goal assumed; configure checkstyle/spotbugs if desired."));
  steps.push(await runStep("test", mvnw, ["-q", "test"], repoPath, 10 * 60 * 1000));
  return { stack: "maven", steps };
}

async function runGradleStack(repoPath: string): Promise<DryRunResult> {
  const steps: StepResult[] = [];
  const gradlew = (await exists(path.join(repoPath, "gradlew"))) ? "./gradlew" : "gradle";
  steps.push(skipped("install", "Gradle resolves dependencies as part of build; no separate install step."));
  steps.push(await runStep("build", gradlew, ["assemble", "-q"], repoPath, 8 * 60 * 1000));
  steps.push(skipped("lint", "No standard Gradle lint task assumed; configure checkstyle/ktlint if desired."));
  steps.push(await runStep("test", gradlew, ["test", "-q"], repoPath, 10 * 60 * 1000));
  return { stack: "gradle", steps };
}
