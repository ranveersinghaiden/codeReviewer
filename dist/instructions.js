import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
const CANDIDATE_ROOT_FILES = [
    "AGENTS.md",
    ".github/copilot-instructions.md",
    "CONTRIBUTING.md",
];
/**
 * Collects coding-agent instruction files from a checked-out repo:
 * - .github/copilot-instructions.md (repo root)
 * - .github/instructions/*.md (nested, applies-to style instructions)
 * - AGENTS.md at repo root
 * - CONTRIBUTING.md at repo root (best-effort context, lower priority)
 */
export async function loadInstructions(repoPath) {
    const docs = [];
    for (const rel of CANDIDATE_ROOT_FILES) {
        const full = path.join(repoPath, rel);
        const content = await readIfExists(full);
        if (content)
            docs.push({ source: rel, content });
    }
    const nestedDir = path.join(repoPath, ".github", "instructions");
    const nestedFiles = await listMdFilesRecursive(nestedDir);
    for (const full of nestedFiles) {
        const rel = path.relative(repoPath, full);
        const content = await readIfExists(full);
        if (content)
            docs.push({ source: rel, content });
    }
    return docs;
}
async function readIfExists(fullPath) {
    try {
        const s = await stat(fullPath);
        if (!s.isFile())
            return null;
        return await readFile(fullPath, "utf8");
    }
    catch {
        return null;
    }
}
async function listMdFilesRecursive(dir) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const results = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...(await listMdFilesRecursive(full)));
        }
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
            results.push(full);
        }
    }
    return results;
}
/** Formats collected instruction docs into a single context block for the reviewer. */
export function formatInstructionsContext(docs) {
    if (docs.length === 0)
        return "(No coding-agent instruction files found in this repo.)";
    return docs
        .map((d) => `### ${d.source}\n\n${d.content.trim()}`)
        .join("\n\n---\n\n");
}
