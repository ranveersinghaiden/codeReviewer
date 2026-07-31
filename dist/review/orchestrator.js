import { buildReviewEvidence } from "./checks.js";
import { formatDuplicateSimilarityMatrix, formatPriorFeedbackMatrix, formatReviewerFindingLedger } from "./report.js";
export function collectReviewEvidence(priorReviewComments, changedFiles) {
    return buildReviewEvidence(priorReviewComments, changedFiles);
}
export function formatReviewEvidence(evidence, reviewerFindings) {
    return [
        ...formatPriorFeedbackMatrix(evidence.priorFeedback),
        ...formatDuplicateSimilarityMatrix(evidence.duplicateSimilarity),
        ...formatReviewerFindingLedger(reviewerFindings),
    ];
}
