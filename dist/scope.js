import path from "node:path";
/**
 * Mirrors the "Module & Language-Specific Rule Skills" table from
 * .github/agents/CodeReviewer.agent.md. Paths are relative-to-repo-root prefixes.
 */
export const MODULE_RULES = [
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
export const PATTERN_RULES = [
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
        test: (p) => p.startsWith(".github/workflows/") && (p.endsWith(".yml") || p.endsWith(".yaml")) ||
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
const FRAMEWORK_FILE_PATTERNS = [
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
export function isFrameworkFile(relPath) {
    const norm = relPath.split(path.sep).join("/");
    return FRAMEWORK_FILE_PATTERNS.some((re) => re.test(norm));
}
export function classifyChangedFiles(filePaths) {
    return filePaths.map((p) => {
        const norm = p.split(path.sep).join("/");
        const modules = [];
        const skillPaths = new Set();
        const instructionPaths = new Set();
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
export function detectOutOfScopeFiles(classifications) {
    const moduleCounts = new Map();
    for (const c of classifications) {
        for (const m of c.modules) {
            moduleCounts.set(m, (moduleCounts.get(m) ?? 0) + 1);
        }
    }
    if (moduleCounts.size <= 1)
        return [];
    const sorted = [...moduleCounts.entries()].sort((a, b) => b[1] - a[1]);
    const dominant = new Set(sorted.filter((_, i) => i === 0).map(([m]) => m));
    return classifications
        .filter((c) => c.modules.length > 0 && !c.modules.some((m) => dominant.has(m)))
        .map((c) => c.path);
}
