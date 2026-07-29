import { buildReviewEvidence } from "./checks.js";
import { formatDuplicateSimilarityMatrix, formatPriorFeedbackMatrix } from "./report.js";
export function collectReviewEvidence(priorReviewComments, changedFiles) {
    return buildReviewEvidence(priorReviewComments, changedFiles);
}
export function formatReviewEvidence(evidence) {
    return [
        ...formatPriorFeedbackMatrix(evidence.priorFeedback),
        ...formatDuplicateSimilarityMatrix(evidence.duplicateSimilarity),
    ];
}
