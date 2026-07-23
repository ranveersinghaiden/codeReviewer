import path from "node:path";

export interface ModulePathRule {
  /** Glob-ish path prefix match (simple startsWith on POSIX-normalized relative path). */
  prefixes: string[];
  skillPaths: string[];
  instructionPaths: string[];
  moduleName: string;
}

/**
 * Mirrors the "Module & Language-Specific Rule Skills" table from
 * .github/agents/CodeReviewer.agent.md. Paths are relative-to-repo-root prefixes.
 */
export const MODULE_RULES: ModulePathRule[] = [
  {
    moduleName: "web-automation (core360)",
    prefixes: ["core360/web-automation/"],
    skillPaths: [".github/skills/review-java-web/SKILL.md"],
    instructionPaths: [".github/instructions/web-automation.instructions.md", ".github/instructions/ui-tests.instructions.md"],
  },
  {
    moduleName: "myeroad-e2e-tests",
    prefixes: ["myeroad/myeroad-e2e-tests/"],
    skillPaths: [".github/skills/review-java-web/SKILL.md"],
    instructionPaths: [".github/instructions/myeroad-e2e-tests.instructions.md", ".github/instructions/ui-tests.instructions.md"],
  },
  {
    moduleName: "eruc-web-automation",
    prefixes: ["myeroad/eruc-web-automation/"],
    skillPaths: [".github/skills/review-java-web/SKILL.md"],
    instructionPaths: [".github/instructions/eruc-web-automation.instructions.md", ".github/instructions/ui-tests.instructions.md"],
  },
  {
    moduleName: "mobile-test-automation",
    prefixes: ["mobile-test-automation/"],
    skillPaths: [".github/skills/review-java-mobile/SKILL.md"],
    instructionPaths: [".github/instructions/logbook-mobile.instructions.md", ".github/instructions/drive-test-automation.instructions.md"],
  },
  {
    moduleName: "core360-api-support",
    prefixes: ["core360/core360-api-support/"],
    skillPaths: [".github/skills/review-java-api/SKILL.md"],
    instructionPaths: [".github/instructions/core360-api-support.instructions.md"],
  },
  {
    moduleName: "myeroad-api-support",
    prefixes: ["myeroad/myeroad-api-support/"],
    skillPaths: [".github/skills/review-java-api/SKILL.md"],
    instructionPaths: [".github/instructions/myeroad-api-support.instructions.md"],
  },
];

/** Files matched by extension/location rather than a fixed module prefix. */
export interface PatternRule {
  test: (relPath: string) => boolean;
  skillPaths: string[];
  label: string;
}

export const PATTERN_RULES: PatternRule[] = [
  {
    label: "python-scripts",
    test: (p) => p.endsWith(".py"),
    skillPaths: [".github/skills/review-python/SKILL.md"],
  },
  {
    label: "bash-scripts",
    test: (p) => p.endsWith(".sh") || p.endsWith(".bash") || p.endsWith(".ps1"),
    skillPaths: [".github/skills/review-bash/SKILL.md"],
  },
  {
    label: "workflows-and-agents",
    test: (p) =>
      p.startsWith(".github/workflows/") && (p.endsWith(".yml") || p.endsWith(".yaml")) ||
      (p.startsWith(".github/agents/") && p.endsWith(".agent.md")) ||
      (p.startsWith(".github/instructions/") && p.endsWith(".instructions.md")),
    skillPaths: [".github/skills/review-workflows/SKILL.md", ".github/skills/review-bash/SKILL.md"],
  },
  {
    label: "docs",
    test: (p) => p.endsWith(".md"),
    skillPaths: [".github/skills/review-docs/SKILL.md"],
  },
];

/**
 * Files that must never be modified without explicit prior user approval, per the
 * CodeReviewer agent's "General Coding-Agent Dos & Don'ts" and per-module skill rules.
 * Matched by basename or path suffix.
 */
const FRAMEWORK_FILE_PATTERNS: RegExp[] = [
  /(^|\/)pom\.xml$/,
  /(^|\/)Hooks\.java$/,
  /(^|\/)PropertyReader\.java$/,
  /(^|\/)Constants\.java$/,
  /(^|\/)EnvGuard\.java$/,
  /(^|\/)AppiumFactory\.java$/,
  /(^|\/)EmulatorManager\.java$/,
  /Runner\.java$/,
  /(^|\/)\.github\/workflows\/.+\.ya?ml$/,
];

export function isFrameworkFile(relPath: string): boolean {
  const norm = relPath.split(path.sep).join("/");
  return FRAMEWORK_FILE_PATTERNS.some((re) => re.test(norm));
}

export interface FileClassification {
  path: string;
  modules: string[];
  skillPaths: string[];
  instructionPaths: string[];
  isFrameworkFile: boolean;
}

export function classifyChangedFiles(filePaths: string[]): FileClassification[] {
  return filePaths.map((p) => {
    const norm = p.split(path.sep).join("/");
    const modules: string[] = [];
    const skillPaths = new Set<string>();
    const instructionPaths = new Set<string>();

    for (const rule of MODULE_RULES) {
      if (rule.prefixes.some((prefix) => norm.startsWith(prefix))) {
        modules.push(rule.moduleName);
        rule.skillPaths.forEach((s) => skillPaths.add(s));
        rule.instructionPaths.forEach((s) => instructionPaths.add(s));
      }
    }
    for (const rule of PATTERN_RULES) {
      if (rule.test(norm)) {
        modules.push(rule.label);
        rule.skillPaths.forEach((s) => skillPaths.add(s));
      }
    }

    return {
      path: p,
      modules,
      skillPaths: [...skillPaths],
      instructionPaths: [...instructionPaths],
      isFrameworkFile: isFrameworkFile(norm),
    };
  });
}

/** Detects scope creep: files touched that don't share a common module with the majority of the diff. */
export function detectOutOfScopeFiles(classifications: FileClassification[]): string[] {
  const moduleCounts = new Map<string, number>();
  for (const c of classifications) {
    for (const m of c.modules) {
      moduleCounts.set(m, (moduleCounts.get(m) ?? 0) + 1);
    }
  }
  if (moduleCounts.size <= 1) return [];
  const sorted = [...moduleCounts.entries()].sort((a, b) => b[1] - a[1]);
  const dominant = new Set(sorted.filter((_, i) => i === 0).map(([m]) => m));
  return classifications
    .filter((c) => c.modules.length > 0 && !c.modules.some((m) => dominant.has(m)))
    .map((c) => c.path);
}
