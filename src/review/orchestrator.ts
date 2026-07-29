import type { PrReviewComment } from "./collectors/github.js";
import { buildReviewEvidence } from "./checks.js";
import { formatDuplicateSimilarityMatrix, formatPriorFeedbackMatrix } from "./report.js";
import type { ChangedFileTarget, ReviewEvidence } from "./types.js";

export function collectReviewEvidence(
  priorReviewComments: PrReviewComment[],
  changedFiles: ChangedFileTarget[]
): ReviewEvidence {
  return buildReviewEvidence(priorReviewComments, changedFiles);
}

export function formatReviewEvidence(evidence: ReviewEvidence): string[] {
  return [
    ...formatPriorFeedbackMatrix(evidence.priorFeedback),
    ...formatDuplicateSimilarityMatrix(evidence.duplicateSimilarity),
  ];
}
