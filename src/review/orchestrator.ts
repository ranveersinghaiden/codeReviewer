import type { PrReviewComment } from "./collectors/github.js";
import { buildReviewEvidence } from "./checks.js";
import {
  formatDuplicateSimilarityMatrix,
  formatCredentialRetrievalMatrix,
  formatPythonEntryPointImportMatrix,
  formatPriorFeedbackMatrix,
  formatReviewerFindingLedger,
  formatWorkflowShellMatrix,
} from "./report.js";
import type { ReviewerFindingRecord } from "./findingsLedger.js";
import type { ChangedFileTarget, ReviewEvidence } from "./types.js";

export function collectReviewEvidence(
  priorReviewComments: PrReviewComment[],
  changedFiles: ChangedFileTarget[],
  diff?: string
): ReviewEvidence {
  return buildReviewEvidence(priorReviewComments, changedFiles, diff);
}

export function formatReviewEvidence(
  evidence: ReviewEvidence,
  reviewerFindings: ReviewerFindingRecord[]
): string[] {
  return [
    ...formatPriorFeedbackMatrix(evidence.priorFeedback),
    ...formatDuplicateSimilarityMatrix(evidence.duplicateSimilarity),
    ...formatWorkflowShellMatrix(evidence.workflowShell),
    ...formatPythonEntryPointImportMatrix(evidence.pythonEntryPointImports),
    ...formatCredentialRetrievalMatrix(evidence.credentialRetrievals),
    ...formatReviewerFindingLedger(reviewerFindings),
  ];
}
