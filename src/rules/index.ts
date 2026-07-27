import { typescriptRules } from "./typescript.js";
import { pythonRules } from "./python.js";
import { javaRules } from "./java.js";
import { cucumberRules } from "./cucumber.js";
import { junitRules } from "./junit.js";
import { yamlRules } from "./yaml.js";
import { markdownRules } from "./markdown.js";

export type RuleCategory =
  | "typescript"
  | "python"
  | "java"
  | "cucumber"
  | "junit"
  | "yaml"
  | "markdown";

export const RULES: Record<RuleCategory, string[]> = {
  typescript: typescriptRules,
  python: pythonRules,
  java: javaRules,
  cucumber: cucumberRules,
  junit: junitRules,
  yaml: yamlRules,
  markdown: markdownRules,
};

/**
 * Classify a changed file path into zero or more rule categories that apply to it.
 * A file can match multiple categories (e.g. a Java test file matches both java + junit).
 */
export function classifyFile(filePath: string): RuleCategory[] {
  const lower = filePath.toLowerCase();
  const categories: RuleCategory[] = [];

  if (/\.feature$/.test(lower)) {
    categories.push("cucumber");
  }
  if (/\.(ts|tsx|mts|cts)$/.test(lower) && !/\.d\.ts$/.test(lower)) {
    categories.push("typescript");
  }
  if (/\.(js|jsx|mjs|cjs)$/.test(lower)) {
    categories.push("typescript"); // JS shares most of the same review heuristics
  }
  if (/\.py$/.test(lower)) {
    categories.push("python");
  }
  if (/\.java$/.test(lower)) {
    categories.push("java");
    if (/test/.test(lower)) {
      categories.push("junit");
    }
  }
  if (/\.ya?ml$/.test(lower)) {
    categories.push("yaml");
  }
  if (/\.md$/.test(lower)) {
    categories.push("markdown");
  }

  return categories;
}

/** Build a de-duplicated, flattened rules list for a set of changed files. */
export function rulesForFiles(filePaths: string[]): Map<RuleCategory, string[]> {
  const applicable = new Set<RuleCategory>();
  for (const f of filePaths) {
    for (const cat of classifyFile(f)) {
      applicable.add(cat);
    }
  }
  const result = new Map<RuleCategory, string[]>();
  for (const cat of applicable) {
    result.set(cat, RULES[cat]);
  }
  return result;
}
