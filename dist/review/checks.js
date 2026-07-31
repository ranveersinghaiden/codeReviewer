const CODE_FILE_PATTERN = /\.(?:java|kt|kts|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|cs|cpp|c|h|hpp|php|scala|groovy|sh|bash|zsh)$/i;
const WORKFLOW_FILE_PATTERN = /^\.github\/workflows\/.+\.ya?ml$/;
const RUN_BLOCK_PATTERN = /^(\s*)(?:-\s+)?run:\s*[>|][+-]?\s*(?:#.*)?$/;
const BARE_TEST_PATTERN = /^\[\[?\s+.+\s+\]\]?\s*;\s*(?:then\s*)?$/;
const HEREDOC_PATTERN = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/g;
function extractRunBlocks(content) {
    const lines = content.split(/\r?\n/);
    const blocks = [];
    for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].match(RUN_BLOCK_PATTERN);
        if (!match)
            continue;
        const parentIndent = (match[1] ?? "").length;
        const block = [];
        for (index += 1; index < lines.length; index += 1) {
            const line = lines[index];
            if (line.trim() && (line.match(/^\s*/)?.[0] ?? "").length <= parentIndent) {
                index -= 1;
                break;
            }
            block.push({ line: index + 1, text: line.trim() });
        }
        blocks.push(block);
    }
    return blocks;
}
export function findWorkflowShellStructuralFindings(content) {
    const findings = [];
    for (const block of extractRunBlocks(content)) {
        const openIfs = [];
        const bareTests = [];
        const openHeredocs = [];
        for (const line of block) {
            if (!line.text || line.text.startsWith("#"))
                continue;
            const heredoc = openHeredocs[0];
            if (heredoc && line.text === heredoc.delimiter) {
                openHeredocs.shift();
                continue;
            }
            for (const match of line.text.matchAll(HEREDOC_PATTERN)) {
                openHeredocs.push({ delimiter: match[1], line: line.line });
            }
            if (/^if\b/.test(line.text)) {
                openIfs.push(line);
                continue;
            }
            if (/^fi(?:\s|;|$)/.test(line.text)) {
                if (openIfs.pop()) {
                    bareTests.length = 0;
                    continue;
                }
                const condition = bareTests.pop();
                findings.push({
                    line: condition?.line ?? line.line,
                    message: condition
                        ? `Conditional test is missing its leading "if" and is closed by "fi" at line ${line.line}.`
                        : 'Unexpected "fi" without a matching "if".',
                });
                bareTests.length = 0;
                continue;
            }
            if (/^(?:else|elif)\b/.test(line.text) && openIfs.length === 0) {
                findings.push({
                    line: line.line,
                    message: `"${line.text.split(/\s/, 1)[0]}" has no matching "if".`,
                });
                continue;
            }
            if (BARE_TEST_PATTERN.test(line.text))
                bareTests.push(line);
        }
        for (const openIf of openIfs) {
            findings.push({ line: openIf.line, message: 'Unclosed "if" block: missing matching "fi".' });
        }
        for (const heredoc of openHeredocs) {
            findings.push({
                line: heredoc.line,
                message: `Unclosed heredoc: missing "${heredoc.delimiter}" terminator.`,
            });
        }
    }
    return findings;
}
/**
 * Creates review obligations for every prior comment and changed file. Semantic
 * comparison remains reviewer judgment; this typed model prevents omission.
 */
export function buildReviewEvidence(priorReviewComments, changedFiles) {
    const priorFeedback = priorReviewComments.map((comment) => ({ comment }));
    const duplicateSimilarity = changedFiles.map((file) => ({
        path: file.path,
        isCode: CODE_FILE_PATTERN.test(file.path),
    }));
    const workflowShell = changedFiles
        .filter((file) => WORKFLOW_FILE_PATTERN.test(file.path))
        .map((file) => ({
        path: file.path,
        findings: file.content === undefined || file.content === null ? [] : findWorkflowShellStructuralFindings(file.content),
        unavailableReason: file.content === undefined || file.content === null
            ? "Workflow content was unavailable; inspect the full file manually."
            : file.truncated
                ? "Workflow content was truncated; inspect the full file manually."
                : null,
    }));
    return { priorFeedback, duplicateSimilarity, workflowShell };
}
