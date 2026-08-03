import { buildReviewEvidence } from "./checks.js";
import { formatDuplicateSimilarityMatrix, formatCredentialRetrievalMatrix, formatPythonEntryPointImportMatrix, formatPriorFeedbackMatrix, formatReviewerFindingLedger, formatWorkflowShellMatrix, } from "./report.js";
export function collectReviewEvidence(priorReviewComments, changedFiles, diff) {
    return buildReviewEvidence(priorReviewComments, changedFiles, diff);
}
export function formatReviewEvidence(evidence, reviewerFindings) {
    return [
        ...formatPriorFeedbackMatrix(evidence.priorFeedback),
        ...formatDuplicateSimilarityMatrix(evidence.duplicateSimilarity),
        ...formatWorkflowShellMatrix(evidence.workflowShell),
        ...formatPythonEntryPointImportMatrix(evidence.pythonEntryPointImports),
        ...formatCredentialRetrievalMatrix(evidence.credentialRetrievals),
        ...formatReviewerFindingLedger(reviewerFindings),
    ];
}
