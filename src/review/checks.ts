import type { PrReviewComment } from "./collectors/github.js";
import type {
  ChangedFileTarget,
  CredentialRetrievalCheck,
  DuplicateSimilarityCheck,
  PriorFeedbackCheck,
  PythonEntryPointImportCheck,
  PythonEntryPointImportFinding,
  ReviewEvidence,
  WorkflowShellCheck,
  WorkflowShellFinding,
} from "./types.js";

const CODE_FILE_PATTERN =
  /\.(?:java|kt|kts|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|cs|cpp|c|h|hpp|php|scala|groovy|sh|bash|zsh)$/i;
const WORKFLOW_FILE_PATTERN = /^\.github\/workflows\/.+\.ya?ml$/;
const PYTHON_ENTRY_POINT_PATTERN = /(?:^|\/)__main__\.py$/;
const LOGIN_RELATED_PATTERN = /(?:login|log[-_ ]?in|sign[-_ ]?in|auth(?:entication)?|credential)/i;
const RUN_BLOCK_PATTERN = /^(\s*)(?:-\s+)?run:\s*[>|][+-]?\s*(?:#.*)?$/;
const BARE_TEST_PATTERN = /^\[\[?\s+.+\s+\]\]?\s*;\s*(?:then\s*)?$/;
const HEREDOC_PATTERN = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/g;
const ABSOLUTE_IMPORT_PATTERN = /^\s*(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)\b/;
const CREDENTIAL_RETRIEVAL_PATTERN =
  /(?:\b(?:get|fetch|read|load)[A-Za-z0-9_]*(?:username|password|credential|secret)|\b(?:username|password|credential|secret)[A-Za-z0-9_]*(?:get|fetch|read|load)|\b(?:System\.getenv|System\.getProperty|os\.environ|process\.env|config(?:uration)?\.(?:get|read)|secrets?\.(?:get|read)))/i;

interface ShellLine {
  line: number;
  text: string;
}

function extractRunBlocks(content: string): ShellLine[][] {
  const lines = content.split(/\r?\n/);
  const blocks: ShellLine[][] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(RUN_BLOCK_PATTERN);
    if (!match) continue;

    const parentIndent = (match[1] ?? "").length;
    const block: ShellLine[] = [];
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

export function findWorkflowShellStructuralFindings(content: string): WorkflowShellFinding[] {
  const findings: WorkflowShellFinding[] = [];

  for (const block of extractRunBlocks(content)) {
    const openIfs: { line: ShellLine; sawThen: boolean }[] = [];
    const bareTests: ShellLine[] = [];
    const openHeredocs: { delimiter: string; line: number }[] = [];

    for (const line of block) {
      if (!line.text || line.text.startsWith("#")) continue;

      const heredoc = openHeredocs[0];
      if (heredoc && line.text === heredoc.delimiter) {
        openHeredocs.shift();
        continue;
      }

      for (const match of line.text.matchAll(HEREDOC_PATTERN)) {
        openHeredocs.push({ delimiter: match[1], line: line.line });
      }

      if (/^if\b/.test(line.text)) {
        openIfs.push({
          line,
          sawThen: /\bthen(?:\s|;|$)/.test(line.text),
        });
        continue;
      }

      if (/^then(?:\s|;|$)/.test(line.text)) {
        const openIf = openIfs.at(-1);
        if (openIf) {
          openIf.sawThen = true;
        }
        continue;
      }

      if (/^fi(?:\s|;|$)/.test(line.text)) {
        const openIf = openIfs.pop();
        if (openIf) {
          if (!openIf.sawThen) {
            findings.push({
              line: openIf.line.line,
              message: `Conditional "if" is missing "then" before "fi" on line ${line.line}.`,
            });
          }
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

      if (BARE_TEST_PATTERN.test(line.text)) bareTests.push(line);
    }

    for (const openIf of openIfs) {
      findings.push({ line: openIf.line.line, message: 'Unclosed "if" block: missing matching "fi".' });
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

export function findPythonEntryPointImportFindings(
  path: string,
  content: string
): PythonEntryPointImportFinding[] {
  if (!PYTHON_ENTRY_POINT_PATTERN.test(path)) return [];

  const packageName = path.split("/").at(-2);
  if (!packageName) return [];

  return content.split(/\r?\n/).flatMap((text, index) => {
    const importedPackage = text.match(ABSOLUTE_IMPORT_PATTERN)?.[1];
    if (importedPackage !== packageName) return [];

    return [{
      line: index + 1,
      message:
        `Entry point imports its local "${packageName}" package absolutely. Verify a documented clean-checkout ` +
        "packaging or bootstrap path makes this import resolvable from the supported invocation.",
    }];
  });
}

function collectCredentialRetrievalChanges(diff: string): Map<string, { added: number; removed: number }> {
  const changes = new Map<string, { added: number; removed: number }>();
  let path: string | null = null;

  for (const line of diff.split(/\r?\n/)) {
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (header) {
      path = header[2];
      continue;
    }
    if (!path || !/^[+-]/.test(line) || /^(?:\+\+\+|---)/.test(line)) continue;
    if (!CREDENTIAL_RETRIEVAL_PATTERN.test(line.slice(1))) continue;

    const change = changes.get(path) ?? { added: 0, removed: 0 };
    if (line.startsWith("+")) change.added += 1;
    else change.removed += 1;
    changes.set(path, change);
  }

  return changes;
}

/**
 * Creates review obligations for every prior comment and changed file. Semantic
 * comparison remains reviewer judgment; this typed model prevents omission.
 */
export function buildReviewEvidence(
  priorReviewComments: PrReviewComment[],
  changedFiles: ChangedFileTarget[],
  diff?: string
): ReviewEvidence {
  const priorFeedback: PriorFeedbackCheck[] = priorReviewComments.map((comment) => ({ comment }));
  const duplicateSimilarity: DuplicateSimilarityCheck[] = changedFiles.map((file) => ({
    path: file.path,
    isCode: CODE_FILE_PATTERN.test(file.path),
  }));
  const workflowShell: WorkflowShellCheck[] = changedFiles
    .filter((file) => WORKFLOW_FILE_PATTERN.test(file.path))
    .map((file) => ({
      path: file.path,
      findings: file.content === undefined || file.content === null ? [] : findWorkflowShellStructuralFindings(file.content),
      unavailableReason:
        file.content === undefined || file.content === null
          ? "Workflow content was unavailable; inspect the full file manually."
          : file.truncated
            ? "Workflow content was truncated; inspect the full file manually."
            : null,
    }));
  const pythonEntryPointImports: PythonEntryPointImportCheck[] = changedFiles
    .filter((file) => PYTHON_ENTRY_POINT_PATTERN.test(file.path))
    .map((file) => ({
      path: file.path,
      findings:
        file.content === undefined || file.content === null
          ? []
          : findPythonEntryPointImportFindings(file.path, file.content),
      unavailableReason:
        file.content === undefined || file.content === null
          ? "Python entry-point content was unavailable; inspect imports manually."
          : file.truncated
            ? "Python entry-point content was truncated; inspect imports manually."
            : null,
    }));
  const credentialChanges = diff === undefined ? null : collectCredentialRetrievalChanges(diff);
  const credentialRetrievals: CredentialRetrievalCheck[] = changedFiles
    .filter((file) => LOGIN_RELATED_PATTERN.test(file.path) || LOGIN_RELATED_PATTERN.test(file.content ?? ""))
    .map((file) => {
      const changes = credentialChanges?.get(file.path) ?? { added: 0, removed: 0 };
      return {
        path: file.path,
        addedRetrievals: changes.added,
        removedRetrievals: changes.removed,
        unavailableReason:
          diff === undefined
            ? "Unified diff was unavailable; compare credential retrieval manually."
            : file.content === undefined || file.content === null
              ? "Login-related source content was unavailable; compare credential retrieval manually."
              : file.truncated
                ? "Login-related source content was truncated; compare credential retrieval manually."
                : null,
      };
    });
  return {
    priorFeedback,
    duplicateSimilarity,
    workflowShell,
    pythonEntryPointImports,
    credentialRetrievals,
  };
}
